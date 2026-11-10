import { DuckDBInstance } from '@duckdb/node-api';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Fingerprinter, bytesFingerprint, identity, type Fingerprint } from '../fingerprint.js';
import { checkStatement, splitStatements } from '../static/sql.js';
import type { Finding, StepKind, TraceStep } from '../types.js';
import { EnvError } from './notebook.js';

interface ManifestNode {
  unique_id: string;
  resource_type: string;
  name: string;
  alias?: string;
  schema: string;
  identifier?: string;
  original_file_path: string;
  depends_on?: { nodes?: string[] };
  meta?: Record<string, unknown>;
  source_meta?: Record<string, unknown>;
  external_location?: string;
  config?: { materialized?: string; meta?: Record<string, unknown> };
}
interface Manifest { nodes: Record<string, ManifestNode>; sources: Record<string, ManifestNode> }
interface RunResults { results: { unique_id: string; status: string; execution_time: number }[] }

export interface DbtPlan {
  dir: string;
  dbt: string;
  profilesDir?: string;
  dbPath: string;
  findings: Finding[];
  select?: string[];
}

function onPath(cmd: string): string | null {
  for (const d of (process.env.PATH ?? '').split(delimiter)) {
    const p = join(d, cmd);
    try { accessSync(p, constants.X_OK); return p; } catch { /* keep looking */ }
  }
  return null;
}

/** Jinja blanked out with newlines kept, so static-check line numbers match the model file. */
export function blankJinja(src: string): string {
  const keepLines = (m: string) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\{#[\s\S]*?#\}/g, keepLines)
    .replace(/\{%[\s\S]*?%\}/g, keepLines)
    .replace(/\{\{\s*(?:ref|source)\s*\(([^)]*)\)\s*\}\}/g, (m, args: string) => {
      const names = [...args.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
      const name = names[names.length - 1] ?? 'ref';
      return (name + ' '.repeat(m.length)).slice(0, Math.max(m.length, name.length));
    })
    .replace(/\{\{[\s\S]*?\}\}/g, (m) => ('x' + ' '.repeat(m.length)).slice(0, m.length));
}

export function planDbt(path: string, opts: { dbt?: string; duckdbPath?: string; select?: string[]; staticOnly?: boolean }): DbtPlan {
  const dir = resolve(path);
  const project = parseYaml(readFileSync(join(dir, 'dbt_project.yml'), 'utf8')) as { profile?: string; 'model-paths'?: string[] };
  const dbtFound = opts.dbt ?? process.env.DP_DBT ?? onPath('dbt');
  const dbt = dbtFound && dbtFound.includes('/') ? resolve(dbtFound) : dbtFound;
  if (!dbt && !opts.staticOnly) throw new EnvError("Couldn't find dbt. Install dbt-core and dbt-duckdb, or point to it with --dbt PATH.");

  // Static checks on every model file.
  const findings: Finding[] = [];
  const modelDirs = project['model-paths'] ?? ['models'];
  const listSql = (d: string): string[] => {
    const abs = join(dir, d);
    if (!existsSync(abs)) return [];
    const out: string[] = [];
    const walk = (p: string) => {
      for (const e of listDir(p)) {
        const q = join(p, e.name);
        if (e.isDirectory()) walk(q);
        else if (e.name.endsWith('.sql')) out.push(q);
      }
    };
    walk(abs);
    return out.sort();
  };
  const state = { seeded: false };
  const projectName = (parseYaml(readFileSync(join(dir, 'dbt_project.yml'), 'utf8')) as { name: string }).name;
  for (const d of modelDirs) {
    for (const f of listSql(d)) {
      const rel = f.slice(dir.length + 1);
      const model = rel.split('/').pop()!.replace(/\.sql$/, '');
      for (const st of splitStatements(blankJinja(readFileSync(f, 'utf8')))) findings.push(...checkStatement(st, rel, `model.${projectName}.${model}`, state));
    }
  }

  // Where the DuckDB file is.
  let dbPath = opts.duckdbPath ? resolve(opts.duckdbPath) : '';
  let profilesDir: string | undefined;
  if (existsSync(join(dir, 'profiles.yml'))) profilesDir = dir;
  if (!dbPath) {
    const profileFile = profilesDir ? join(profilesDir, 'profiles.yml') : join(process.env.DBT_PROFILES_DIR ?? join(homedir(), '.dbt'), 'profiles.yml');
    if (!existsSync(profileFile)) {
      if (opts.staticOnly) return { dir, dbt: dbt ?? 'dbt', profilesDir, dbPath: '', findings, select: opts.select };
      throw new EnvError(`Couldn't find profiles.yml (looked in the project and ${profileFile}). Pass --duckdb-path to say where the DuckDB file is.`);
    }
    const profiles = parseYaml(readFileSync(profileFile, 'utf8')) as Record<string, { target?: string; outputs?: Record<string, { type?: string; path?: string }> }>;
    const prof = profiles[project.profile ?? ''];
    const target = prof?.outputs?.[process.env.DBT_TARGET ?? prof.target ?? 'dev'];
    if (!target) throw new EnvError(`profiles.yml has no profile "${project.profile}" with a target to use.`);
    if (target.type !== 'duckdb') {
      if (!opts.staticOnly) throw new EnvError(`This version hashes dbt-duckdb projects only (this one uses ${target.type}). The static checks still work: add --static-only.`);
    } else {
      if (!target.path || target.path === ':memory:' || target.path.startsWith('md:')) {
        if (!opts.staticOnly) throw new EnvError('The dbt-duckdb profile writes to memory (or MotherDuck), so there is no file to read the results from. Point it at a .duckdb file.');
      } else dbPath = resolve(dir, target.path);
    }
  }
  return { dir, dbt: dbt ?? 'dbt', profilesDir, dbPath, findings, select: opts.select };
}

function listDir(p: string) {
  return readdirSync(p, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
}

const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';

async function fingerprintRelation(conn: Awaited<ReturnType<DuckDBInstance['connect']>>, schema: string, name: string): Promise<Fingerprint> {
  const result = await conn.stream(`SELECT * FROM ${q(schema)}.${q(name)}`);
  const fp = new Fingerprinter(result.columnNames(), false);
  for await (const rows of result.yieldRowsJson()) for (const row of rows) fp.addRow(row as unknown[]);
  return fp.finish();
}

/** One run: dbt build --full-refresh, then fingerprint every built relation and every source. */
export async function runDbtOnce(plan: DbtPlan, run: number): Promise<{ steps: TraceStep[]; notes: string[] }> {
  const tmp = mkdtempSync(join(tmpdir(), 'determinism-profiler-dbt-'));
  try {
    const target = join(tmp, `run-${run}`);
    // --full-refresh every run: otherwise runs 2..N measure incremental logic, not determinism.
    const args = ['build', '--full-refresh', '--target-path', target, '--project-dir', plan.dir];
    if (plan.profilesDir) args.push('--profiles-dir', plan.profilesDir);
    if (plan.select?.length) args.push('--select', ...plan.select.map((s) => (/^[A-Za-z0-9_]+$/.test(s) ? `+${s}` : s)));
    const r = spawnSync(plan.dbt, args, { cwd: plan.dir, encoding: 'utf8', maxBuffer: 64 << 20 });
    if (!existsSync(join(target, 'run_results.json'))) {
      const line = (r.stdout + r.stderr).split('\n').find((l) => /Error|error/.test(l))?.split(':')[0]?.trim();
      throw new EnvError(`dbt build didn't finish (${line || `exit ${r.status}`}). Run it once yourself to see why.`);
    }
    const manifest = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')) as Manifest;
    const results = JSON.parse(readFileSync(join(target, 'run_results.json'), 'utf8')) as RunResults;
    const notes: string[] = [];
    const steps: TraceStep[] = [];
    const latest = new Map<string, Record<string, Fingerprint>>();
    const instance = await DuckDBInstance.create(plan.dbPath, { access_mode: 'READ_ONLY' });
    const conn = await instance.connect();
    try {
      // Sources first: external files by their bytes, tables by their rows.
      const usedSources = new Set(Object.values(manifest.nodes).flatMap((n) => n.depends_on?.nodes ?? []).filter((x) => x.startsWith('source.')));
      for (const id of usedSources) {
        const s = manifest.sources[id];
        if (!s) continue;
        const ext = (s.external_location ?? (s.meta?.external_location as string) ?? (s.source_meta?.external_location as string)) as string | undefined;
        let fp: Fingerprint;
        if (ext) {
          const file = /['"]([^'"]+)['"]/.exec(ext.replaceAll('{name}', s.name))?.[1] ?? ext.replaceAll('{name}', s.name);
          const p = resolve(plan.dir, file);
          fp = existsSync(p) ? bytesFingerprint(readFileSync(p)) : { ...bytesFingerprint(new Uint8Array()), skipped: 'file not found' };
        } else {
          try { fp = await fingerprintRelation(conn, s.schema, s.identifier ?? s.name); }
          catch { fp = { ...bytesFingerprint(new Uint8Array()), skipped: 'source table not readable' }; }
        }
        latest.set(id, { [s.name]: fp });
        steps.push({ step_id: id, kind: 'source', label: `source ${s.name}`, location: { file: s.original_file_path }, parents: [], input_hashes: {}, outputs: { [s.name]: fp }, duration_ms: 0, status: 'ok' });
      }
      const timing = new Map(results.results.map((x) => [x.unique_id, x]));
      // manifest.nodes isn't in run order; dbt's own order is the run_results order, which respects the DAG.
      for (const res of results.results) {
        const n = manifest.nodes[res.unique_id];
        if (!n || !['model', 'seed', 'snapshot'].includes(n.resource_type)) continue;
        const kind: StepKind = n.resource_type === 'seed' ? 'dbt_seed' : n.resource_type === 'snapshot' ? 'dbt_snapshot' : 'dbt_model';
        const parents = (n.depends_on?.nodes ?? []).filter((p) => !p.startsWith('test.'));
        const input_hashes: Record<string, string> = {};
        for (const p of parents) for (const [name, fp] of Object.entries(latest.get(p) ?? {})) input_hashes[`${p}#${name}`] = identity(fp);
        const outputs: Record<string, Fingerprint> = {};
        let status: TraceStep['status'] = res.status === 'success' ? 'ok' : 'error';
        if (status === 'ok') {
          if (n.config?.materialized === 'view') notes.push(`${n.name} is a view, so it's re-run when read; its fingerprint may not match what the next model saw.`);
          if (n.config?.materialized === 'ephemeral') continue;
          try { outputs[n.name] = await fingerprintRelation(conn, n.schema, n.alias ?? n.name); }
          catch { status = 'error'; }
        }
        latest.set(n.unique_id, outputs);
        steps.push({
          step_id: n.unique_id, kind, label: `${n.resource_type} ${n.name}`, location: { file: n.original_file_path },
          parents, input_hashes, outputs, duration_ms: Math.round((timing.get(n.unique_id)?.execution_time ?? 0) * 1000),
          status, error: status === 'error' ? res.status : undefined, params: { materialized: n.config?.materialized ?? 'view' },
        });
      }
    } finally {
      conn.closeSync();
      instance.closeSync();
    }
    // Tests: recorded as notes, not steps.
    const failed = results.results.filter((x) => x.unique_id.startsWith('test.') && x.status !== 'pass').length;
    if (failed) notes.push(`${failed} dbt test${failed === 1 ? '' : 's'} didn't pass in run ${run}.`);
    return { steps, notes };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
