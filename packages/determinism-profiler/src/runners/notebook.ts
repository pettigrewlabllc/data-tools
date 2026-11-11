import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { Fingerprinter, sourceHash, type Fingerprint } from '../fingerprint.js';
import { checkCell } from '../static/python.js';
import type { Finding, TraceStep } from '../types.js';
import { HELPER, PREFLIGHT } from './notebook-python.js';

export class EnvError extends Error {}

interface NbCell { cell_type: string; source: string | string[]; outputs?: NbOutput[]; metadata?: Record<string, unknown>; execution_count?: number | null; id?: string }
interface NbOutput { output_type: string; name?: string; text?: string | string[]; data?: Record<string, unknown>; ename?: string }
interface Nb { cells: NbCell[]; metadata: Record<string, unknown>; nbformat: number; nbformat_minor: number }

export interface CellInfo {
  stores: string[];
  loads: string[];
  reads: string[];
  writes: string[];
  funcs: Record<string, string[]>;
  imports: boolean;
  error: string | null;
}

export interface NbCellPlan {
  n: number; // 1-based code-cell number
  index: number; // index in nb.cells
  id: string;
  source: string;
  info: CellInfo;
  loads: string[]; // own loads + loads of functions it calls
  parents: string[];
  inputIds: Record<string, string>; // input id → what to hash in the pre-cell: "var:<name>" | "file:<path>"
  outNames: string[]; // names to fingerprint after the cell
  judgment: boolean;
}

export interface NbPlan {
  path: string;
  dir: string;
  name: string;
  nb: Nb;
  cells: NbCellPlan[];
  sources: string[];
  findings: Finding[];
  include: Set<number>;
  scopeNote?: string;
}

const text = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join('') : s ?? '');

function onPath(cmd: string): string | null {
  for (const d of (process.env.PATH ?? '').split(delimiter)) {
    const p = join(d, cmd);
    try { accessSync(p, constants.X_OK); return p; } catch { /* keep looking */ }
  }
  return null;
}

export function findJupyter(explicit?: string): { jupyter: string; python: string } {
  const found = explicit ?? process.env.DP_JUPYTER ?? onPath('jupyter');
  const jupyter = found ? resolve(found) : null;
  if (!jupyter || !existsSync(jupyter)) {
    throw new EnvError("Couldn't find jupyter. Install it (pip install nbconvert ipykernel) or point to it with --jupyter PATH.");
  }
  const sib = ['python', 'python3'].map((p) => join(dirname(jupyter), p)).find((p) => existsSync(p));
  return { jupyter, python: sib ?? onPath('python3') ?? 'python3' };
}

function parseCells(python: string, sources: string[]): CellInfo[] {
  const r = spawnSync(python, ['-I', '-c', PREFLIGHT], { input: JSON.stringify(sources.map((source) => ({ source }))), encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new EnvError(`Couldn't read the notebook's cells with ${python} (exit ${r.status}).`);
  return JSON.parse(r.stdout) as CellInfo[];
}

/** Reads the notebook, builds the def-use graph, runs static checks. No kernel yet. */
export function planNotebook(path: string, python: string, cellsArg?: string): NbPlan {
  const abs = resolve(path);
  const nb = JSON.parse(readFileSync(abs, 'utf8')) as Nb;
  const name = basename(abs);
  const code = nb.cells.map((c, index) => ({ c, index })).filter((x) => x.c.cell_type === 'code');
  const infos = parseCells(python, code.map((x) => text(x.c.source)));
  const cells: NbCellPlan[] = [];
  const lastWriter = new Map<string, string>(); // var name → cell id whose outputs last included it
  const fileWriter = new Map<string, string>(); // path → cell id that last wrote it
  const funcLoads = new Map<string, string[]>();
  const funcCell = new Map<string, number>(); // function name → cell number that defined it
  const sources = new Set<string>();
  const findings: Finding[] = [];
  const pyState = { seeded: false };
  code.forEach(({ c, index }, i) => {
    const n = i + 1;
    const id = `cell-${n}`;
    const info = infos[i];
    const source = text(c.source);
    for (const [f, l] of Object.entries(info.funcs)) { funcLoads.set(f, l); funcCell.set(f, n); }
    const loads = [...info.loads];
    for (const l of info.loads) for (const extra of funcLoads.get(l) ?? []) if (!loads.includes(extra)) loads.push(extra);
    const parents = new Set<string>();
    const inputIds: Record<string, string> = {};
    for (const l of loads) {
      const w = lastWriter.get(l);
      if (w) { parents.add(w); inputIds[`${w}#${l}`] = `var:${l}`; }
    }
    for (const p of info.reads) {
      const w = fileWriter.get(p);
      if (w) { parents.add(w); inputIds[`${w}#file:${p}`] = `file:${p}`; }
      else { sources.add(p); parents.add(`source:${p}`); inputIds[`source:${p}#file`] = `file:${p}`; }
    }
    const outNames = [...new Set([...info.stores, ...loads.filter((l) => lastWriter.has(l))])];
    const cellFindings = checkCell(source, name, n, id, pyState);
    // A cause inside a function body shows up where the function is called, too.
    for (const l of info.loads) {
      const d = funcCell.get(l);
      if (d && d !== n) for (const f of findings.filter((x) => x.cell === d && x.step === `cell-${d}`)) cellFindings.push({ ...f, step: id });
    }
    findings.push(...cellFindings);
    cells.push({ n, index, id, source, info, loads, parents: [...parents], inputIds, outNames, judgment: cellFindings.some((f) => f.kind === 'judgment') });
    for (const o of outNames) lastWriter.set(o, id);
    for (const p of info.writes) fileWriter.set(p, id);
  });

  // Subset: chosen cells, their parents, and every cell that stores nothing or imports (seeds, options, chdir).
  let include = new Set(cells.map((c) => c.n));
  let scopeNote: string | undefined;
  if (cellsArg) {
    const want = new Set<number>();
    for (const part of cellsArg.split(',')) {
      const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
      if (!m) throw new EnvError(`--cells takes numbers and ranges like 2,4-6 (got "${part}").`);
      for (let k = Number(m[1]); k <= Number(m[2] ?? m[1]); k++) want.add(k);
    }
    const chosen = new Set(want);
    const byId = new Map(cells.map((c) => [c.id, c]));
    const stack = [...want].map((k) => cells[k - 1]).filter(Boolean);
    while (stack.length) {
      const c = stack.pop()!;
      for (const p of c.parents) {
        const pc = byId.get(p);
        if (pc && !want.has(pc.n)) { want.add(pc.n); stack.push(pc); }
      }
    }
    const setup = cells.filter((c) => !want.has(c.n) && (c.info.stores.length === 0 || c.info.imports) && c.n < Math.max(...chosen));
    for (const c of setup) want.add(c.n);
    include = want;
    const added = [...want].filter((k) => !chosen.has(k)).sort((a, b) => a - b);
    const chosenList = [...chosen].sort((a, b) => a - b);
    scopeNote = `Profiled ${listOf('cell', chosenList)}` +
      (added.length ? `, plus ${listOf('cell', added)} that ${chosenList.length === 1 ? 'it needs' : 'they need'} or that set things up (imports, seeds, options).` : '.');
  }
  return {
    path: abs, dir: dirname(abs), name, nb, cells: cells.filter((c) => include.has(c.n)), sources: [...sources],
    findings: findings.filter((f) => include.has(f.cell ?? 0)), include, scopeNote,
  };
}

const py = (s: string) => JSON.stringify(s); // JSON strings are valid Python string literals

function hiddenCell(src: string): NbCell {
  return { cell_type: 'code', source: src, outputs: [], metadata: { tags: ['determinism-profiler'] }, execution_count: null };
}

/** Builds the instrumented copy: setup cell, then pre/user/post for every included code cell. */
function instrument(plan: NbPlan, logPath: string): Nb {
  const setup = HELPER.replace('__DP_DIR__', py(plan.dir)).replace('__DP_LOG__', py(logPath));
  const cells: NbCell[] = [hiddenCell(setup)];
  const byIndex = new Map(plan.cells.map((c) => [c.index, c]));
  plan.nb.cells.forEach((c, index) => {
    if (c.cell_type !== 'code') return;
    const p = byIndex.get(index);
    if (!p) return;
    const preNames = [...new Set(Object.values(p.inputIds).filter((x) => x.startsWith('var:')).map((x) => x.slice(4)))];
    const preFiles = [...new Set(Object.values(p.inputIds).filter((x) => x.startsWith('file:')).map((x) => x.slice(5)))];
    cells.push(hiddenCell(`_dp_pre(${p.n}, ${JSON.stringify(preNames)}, ${JSON.stringify(preFiles)})`));
    cells.push({ ...c, outputs: [], execution_count: null, metadata: { ...(c.metadata ?? {}), dp_cell: p.n } });
    cells.push(hiddenCell(`_dp_post(${p.n}, ${JSON.stringify(p.outNames)}, ${JSON.stringify(p.info.writes)})`));
  });
  const nb: Nb = { ...plan.nb, cells };
  for (const c of nb.cells) delete c.id; // nbformat 4.5 ids must be unique; let nbconvert add fresh ones
  nb.nbformat_minor = Math.min(nb.nbformat_minor, 4);
  return nb;
}

/** The display output of a user cell: stdout and text results, addresses masked, stderr left out. */
function displayFingerprint(outputs: NbOutput[]): { fp: Fingerprint; error?: string } {
  const lines: string[] = [];
  let skipped = 0;
  let error: string | undefined;
  for (const o of outputs) {
    if (o.output_type === 'stream') {
      if (o.name === 'stderr') continue;
      lines.push(...text(o.text).split('\n'));
    } else if (o.output_type === 'execute_result' || o.output_type === 'display_data') {
      const d = o.data ?? {};
      if ('text/plain' in d && !Object.keys(d).some((k) => k.startsWith('image/') || k.includes('widget'))) lines.push(...text(d['text/plain'] as string | string[]).split('\n'));
      else skipped++;
    } else if (o.output_type === 'error') {
      error = o.ename ?? 'Error';
      lines.push(`error:${error}`);
    }
  }
  const fp = new Fingerprinter(['line'], true);
  for (const l of lines) fp.addRow([l.replace(/ at 0x[0-9a-fA-F]+/g, ' at 0x?')]);
  const out = fp.finish();
  if (!lines.length && skipped) out.skipped = 'image or widget output';
  return { fp: out, error };
}

interface LogRec { cell: number; phase: 'pre' | 'post'; t: number; vars: Record<string, Fingerprint>; files: Record<string, string | null> }

const fileFp = (digest: string | null): Fingerprint =>
  digest
    ? { rows: 1, ordered: digest, unordered: digest, rounded: digest, columns: {}, order_matters: false }
    : { rows: 0, ordered: '', unordered: '', rounded: '', columns: {}, order_matters: false, skipped: 'file not there' };

export interface NbRunOptions { jupyter: string; kernel?: string; timeoutSec?: number }

/** One run: fresh kernel via the user's nbconvert, then read the log and the executed copy. */
export function runNotebookOnce(plan: NbPlan, opts: NbRunOptions): { steps: TraceStep[]; notes: string[] } {
  const tmp = mkdtempSync(join(tmpdir(), 'determinism-profiler-'));
  try {
    const logPath = join(tmp, 'log.jsonl');
    const nbPath = join(tmp, 'instrumented.ipynb');
    writeFileSync(nbPath, JSON.stringify(instrument(plan, logPath)));
    const args = ['nbconvert', '--to', 'notebook', '--execute', '--allow-errors', `--ExecutePreprocessor.timeout=${opts.timeoutSec ?? 1800}`,
      '--output-dir', tmp, '--output', 'executed.ipynb', nbPath];
    if (opts.kernel) args.splice(3, 0, `--ExecutePreprocessor.kernel_name=${opts.kernel}`);
    const env = { ...process.env };
    delete env.PYTHONHASHSEED; // a real rerun gets a fresh hash seed; so does this one
    const r = spawnSync(opts.jupyter, args, { cwd: plan.dir, encoding: 'utf8', env, maxBuffer: 64 << 20 });
    if (r.status !== 0) {
      const kind = /No such kernel named (\S+)/.exec(r.stderr ?? '')?.[0] ?? (r.stderr ?? '').split('\n').filter((l) => /Error/.test(l)).pop()?.split(':')[0] ?? `exit ${r.status}`;
      throw new EnvError(`jupyter nbconvert couldn't run the notebook (${kind.trim()}).`);
    }
    const executed = JSON.parse(readFileSync(join(tmp, 'executed.ipynb'), 'utf8')) as Nb;
    const recs = existsSync(logPath)
      ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogRec)
      : [];
    const pre = new Map(recs.filter((x) => x.phase === 'pre').map((x) => [x.cell, x]));
    const post = new Map(recs.filter((x) => x.phase === 'post').map((x) => [x.cell, x]));
    const displays = new Map<number, NbOutput[]>();
    for (const c of executed.cells) {
      const n = c.metadata?.dp_cell;
      if (typeof n === 'number') displays.set(n, c.outputs ?? []);
    }
    const steps: TraceStep[] = [];
    for (const src of plan.sources) {
      const firstPre = plan.cells.map((c) => pre.get(c.n)).find((p) => p && src in p.files);
      const fp = fileFp(firstPre?.files[src] ?? null);
      steps.push({ step_id: `source:${src}`, kind: 'source', label: src, location: { file: src }, parents: [], input_hashes: {}, outputs: { file: fp }, duration_ms: 0, status: 'ok' });
    }
    for (const c of plan.cells) {
      const a = pre.get(c.n);
      const b = post.get(c.n);
      const input_hashes: Record<string, string> = {};
      for (const [id, what] of Object.entries(c.inputIds)) {
        const fp = what.startsWith('var:') ? a?.vars[what.slice(4)] : a ? fileFp(a.files[what.slice(5)] ?? null) : undefined;
        if (fp) input_hashes[id] = fp.skipped ? 'skipped' : fp.order_matters ? fp.ordered : fp.unordered;
      }
      const outputs: Record<string, Fingerprint> = {};
      for (const [k, v] of Object.entries(b?.vars ?? {})) {
        // A name the cell only read counts as an output only if the cell changed it (in-place mutation).
        const before = a?.vars[k];
        if (!c.info.stores.includes(k) && before && before.ordered === v.ordered && before.unordered === v.unordered) continue;
        outputs[k] = v;
      }
      for (const [p, d] of Object.entries(b?.files ?? {})) outputs[`file:${p}`] = fileFp(d);
      const disp = displayFingerprint(displays.get(c.n) ?? []);
      if (disp.fp.rows > 0 || disp.fp.skipped) outputs.display = disp.fp;
      steps.push({
        step_id: c.id,
        kind: 'cell',
        label: cellLabel(c.n, c.info.stores.filter((s) => b && s in b.vars)),
        location: { file: plan.name, cell: c.n, line: 1 },
        parents: c.parents,
        source_hash: sourceHash(c.source),
        input_hashes,
        outputs,
        duration_ms: a && b ? Math.round((b.t - a.t) * 1000) : 0,
        status: disp.error ? 'error' : a && b ? 'ok' : 'not_run',
        error: disp.error,
        judgment: c.judgment,
      });
    }
    return { steps, notes: [] };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function cellLabel(n: number, names: string[]): string {
  if (!names.length) return `cell ${n}`;
  return `cell ${n} (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''})`;
}

function listOf(word: string, ns: number[]): string {
  if (ns.length === 1) return `${word} ${ns[0]}`;
  return `${word}s ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}
