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

export { EnvError };

export interface ProfileOptions {
  runs?: number;
  cells?: string;
  select?: string[];
  staticOnly?: boolean;
  jupyter?: string;
  dbt?: string;
  kernel?: string;
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

export async function profile(path: string, opts: ProfileOptions = {}): Promise<{ report: Report; traces: Trace[] }> {
  const kind = detectKind(path);
  const runs = opts.staticOnly ? 0 : Math.max(2, opts.runs ?? 3);
  const name = basename(resolve(path));
  const notes: string[] = [];
  let findings: Finding[] = [];
  let runOnce: (i: number) => Promise<{ steps: TraceStep[]; notes: string[] }>;
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
    runOnce = async () => ({ steps: await runSqlOnce(plan, include), notes: [] });
  } else if (kind === 'notebook') {
    const env = opts.staticOnly ? { jupyter: '', python: findJupyterPython(opts.jupyter) } : findJupyter(opts.jupyter);
    const plan = planNotebook(path, env.python, opts.cells);
    findings = plan.findings;
    if (plan.scopeNote) notes.push(plan.scopeNote);
    if (opts.cells) params.cells = true;
    if (opts.kernel) params.kernel = opts.kernel;
    if (!opts.staticOnly) notes.push("Images and widgets in cell output aren't compared.");
    runOnce = async () => runNotebookOnce(plan, { jupyter: env.jupyter, kernel: opts.kernel });
  } else {
    const plan = planDbt(path, { dbt: opts.dbt, duckdbPath: opts.duckdbPath, select: opts.select, staticOnly: opts.staticOnly });
    findings = plan.findings;
    params.full_refresh = true;
    if (opts.select?.length) params.select = true;
    runOnce = (i) => runDbtOnce(plan, i);
  }

  const traces: Trace[] = [];
  for (let i = 1; i <= runs; i++) {
    opts.onRun?.(i, runs);
    const started_at = new Date().toISOString();
    const r = await runOnce(i);
    for (const n of r.notes) if (!notes.includes(n)) notes.push(n);
    traces.push({ schema: 'determinism-profiler/trace@1', tool_version: VERSION, input: { kind, name }, run: i, started_at, params, steps: r.steps, notes: r.notes });
  }

  const compared = runs
    ? compareRuns(traces, findings)
    : { steps: [], sources: [], findings: findings.map((f) => ({ ...f, status: f.kind === 'candidate' ? 'candidate' as const : 'latent' as const })), score: { same: 0, scored: 0, percent: 0 } };
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
  return { report, traces };
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
