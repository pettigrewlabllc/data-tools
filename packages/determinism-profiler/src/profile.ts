import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { compareRuns } from './compare.js';
import { renderHtml } from './report/html.js';
import { renderMarkdown } from './report/markdown.js';
import { planDbt, runDbtOnce } from './runners/dbt.js';
import { EnvError, findJupyter, planNotebook, runNotebookOnce } from './runners/notebook.js';
import { planSql, runSqlOnce, selectSql } from './runners/sql.js';
import type { Finding, InputKind, Report, Trace, TraceStep } from './types.js';
import { VERSION } from './version.js';
import { ADDRESS_MASK, DEFAULT_MASKS, loadSanitize, type Mask } from './masks.js';
import { MASK_NOTE } from './report/words.js';
import { changedRows, type ChangedRowsResult, type KeepPolicy, type KeptRun } from './changed-rows.js';
import { identity, type Fingerprint } from './fingerprint.js';

function readSanitize(path: string): Mask[] {
  if (!existsSync(path)) throw new EnvError(`There's no sanitize file at ${path}.`);
  try { return loadSanitize(path); } catch (e) { throw new EnvError((e as Error).message); }
}

export { EnvError };

export interface ProfileOptions {
  runs?: number;
  cells?: string;
  select?: string[];
  staticOnly?: boolean;
  jupyter?: string;
  dbt?: string;
  kernel?: string;
  /** nbval-format file of extra masks for notebook printed output. */
  sanitize?: string;
  /** false turns off the built-in timestamp, duration and progress-bar masks. */
  defaultMasks?: boolean;
  /** SQL and dbt: list up to 10 changed key values per changed step, in the terminal only. */
  showChangedRows?: boolean;
  duckdbPath?: string;
  onRun?: (run: number, of: number) => void;
}

export function detectKind(path: string): InputKind {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new EnvError(`There's nothing at ${path}.`);
  if (abs.endsWith('.ipynb')) return 'notebook';
  if (statSync(abs).isDirectory()) {
    if (existsSync(join(abs, 'dbt_project.yml'))) return 'dbt';
    const hasSql = (d: string): boolean => readdirSync(d, { withFileTypes: true }).some((e) =>
      !e.name.startsWith('.') && (e.isDirectory() ? e.name !== 'node_modules' && hasSql(join(d, e.name)) : e.name.endsWith('.sql')));
    if (hasSql(abs)) return 'sql';
  } else if (abs.endsWith('.sql')) return 'sql';
  throw new EnvError(`${path} isn't a notebook (.ipynb), a folder of .sql files, or a dbt project.`);
}

export interface ProfileResult {
  report: Report;
  traces: Trace[];
  /** --show-changed-rows only. Holds key values: print it, never write it (PRD D1). */
  changedRows?: ChangedRowsResult[] | 'not_supported';
}

export async function profile(path: string, opts: ProfileOptions = {}): Promise<ProfileResult> {
  const kind = detectKind(path);
  const runs = opts.staticOnly ? 0 : Math.max(2, opts.runs ?? 3);
  const name = basename(resolve(path));
  const notes: string[] = [];
  let findings: Finding[] = [];
  let runOnce: (i: number) => Promise<{ steps: TraceStep[]; notes: string[]; kept?: KeptRun }>;
  const traces: Trace[] = [];
  // Run 1 keeps every step; later runs only steps that differ from run 1 (memory follows what changed).
  const keep: KeepPolicy | undefined = opts.showChangedRows && !opts.staticOnly && kind !== 'notebook'
    ? (id, outputs) => {
      if (!traces.length) return true;
      const base = traces[0].steps.find((s) => s.step_id === id);
      return !base || outputSig(base.outputs) !== outputSig(outputs);
    }
    : undefined;
  const params: Record<string, string | number | boolean> = { runs };

  if (kind === 'sql') {
    const plan = planSql(path);
    findings = plan.findings;
    const include = opts.select?.length ? selectSql(plan, opts.select) : null;
    if (include) {
      notes.push(`Profiled ${include.size} of ${plan.steps.filter((s) => s.isStep).length} steps: the ones you picked and the steps they read from.`);
      findings = findings.filter((f) => include.has(f.step));
      params.select = true;
    }
    runOnce = async () => ({ ...(await runSqlOnce(plan, include, keep)), notes: [] });
  } else if (kind === 'notebook') {
    const env = opts.staticOnly ? { jupyter: '', python: findJupyterPython(opts.jupyter) } : findJupyter(opts.jupyter);
    const plan = planNotebook(path, env.python, opts.cells);
    findings = plan.findings;
    if (plan.scopeNote) notes.push(plan.scopeNote);
    if (opts.cells) params.cells = true;
    if (opts.kernel) params.kernel = opts.kernel;
    if (!opts.staticOnly) notes.push("Images and widgets in cell output aren't compared.");
    const masks = [ADDRESS_MASK, ...(opts.defaultMasks === false ? [] : DEFAULT_MASKS), ...(opts.sanitize ? readSanitize(opts.sanitize) : [])];
    if (opts.defaultMasks === false) params.default_masks = false;
    if (opts.sanitize) params.sanitize = true;
    runOnce = async () => runNotebookOnce(plan, { jupyter: env.jupyter, kernel: opts.kernel, masks });
  } else {
    const plan = planDbt(path, { dbt: opts.dbt, duckdbPath: opts.duckdbPath, select: opts.select, staticOnly: opts.staticOnly });
    findings = plan.findings;
    params.full_refresh = true;
    if (opts.select?.length) params.select = true;
    runOnce = (i) => runDbtOnce(plan, i, keep);
  }

  if (keep) params.show_changed_rows = true;
  const kept: KeptRun[] = [];
  try {
    for (let i = 1; i <= runs; i++) {
      opts.onRun?.(i, runs);
      const started_at = new Date().toISOString();
      const r = await runOnce(i);
      if (r.kept) kept[i - 1] = r.kept;
      for (const n of r.notes) if (!notes.includes(n)) notes.push(n);
      traces.push({ schema: 'determinism-profiler/trace@1', tool_version: VERSION, input: { kind, name }, run: i, started_at, params, steps: r.steps, notes: r.notes });
    }

    const compared = runs
      ? compareRuns(traces, findings)
      : { steps: [], sources: [], findings: findings.map((f) => ({ ...f, status: f.kind === 'candidate' ? 'candidate' as const : 'latent' as const })), score: { same: 0, scored: 0, percent: 0 } };
    if (kind === 'notebook' && opts.defaultMasks !== false && compared.steps.some((s) => s.masked)) notes.push(MASK_NOTE);
    const report: Report = {
      schema: 'determinism-profiler/report@1',
      tool_version: VERSION,
      input: { kind, name },
      runs,
      generated_at: new Date().toISOString(),
      ...compared,
      notes,
      static_only: !!opts.staticOnly,
    };
    let changed: ProfileResult['changedRows'];
    if (opts.showChangedRows && !opts.staticOnly) {
      changed = kind === 'notebook' ? 'not_supported' : await changedRows(report.steps, kept, (id) => firstDiffering(traces, id));
    }
    return { report, traces, ...(changed ? { changedRows: changed } : {}) };
  } finally {
    for (const k of kept) k?.close();
  }
}

/** Run 1 and the first run whose output for this step differs from it, as 0-based indexes. */
const outputSig = (outputs: Record<string, Fingerprint>) => JSON.stringify(Object.entries(outputs).map(([k, f]) => [k, identity(f)]).sort());

function firstDiffering(traces: Trace[], id: string): [number, number] | null {
  const sig = (t: Trace) => outputSig(t.steps.find((s) => s.step_id === id)?.outputs ?? {});
  const base = sig(traces[0]);
  const i = traces.findIndex((t) => sig(t) !== base);
  return i > 0 ? [0, i] : null;
}

function findJupyterPython(explicit?: string): string {
  try { return findJupyter(explicit).python; } catch { return 'python3'; }
}

export function writeOutputs(outDir: string, report: Report, traces: Trace[]): string[] {
  mkdirSync(outDir, { recursive: true });
  const files: [string, string][] = [
    ...traces.map((t) => [`trace-run-${t.run}.json`, JSON.stringify(t, null, 2)] as [string, string]),
    ['report.json', JSON.stringify(report, null, 2)],
    ['report.md', renderMarkdown(report)],
    ['report.html', renderHtml(report)],
  ];
  for (const [f, body] of files) writeFileSync(join(outDir, f), body);
  return files.map(([f]) => join(outDir, f));
}
