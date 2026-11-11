#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { relative, resolve } from 'node:path';
import { EnvError, profile, writeOutputs } from './profile.js';
import { renderTerminal } from './report/terminal.js';
import { VERSION } from './version.js';

const HELP = `determinism-profiler ${VERSION}

Run an analysis several times and see which steps give the same answer, and why the others don't.

Usage:
  determinism-profiler <notebook.ipynb | sql-folder | dbt-project> [options]

Options:
  --runs N           how many times to run it (default 3)
  --cells 2,4-6      notebook: profile these cells and the ones they need
  --select NAMES     SQL: these files or tables and what they read from
                     dbt: passed to dbt --select (a bare model name means +name)
  --static-only      just read the code, don't run anything
  --out DIR          where to write the report and traces (default ./.determinism)
  --fail-on WHEN     differs (default) or never: when to exit 1
  --jupyter PATH     the jupyter to use (default: the one on your PATH)
  --kernel NAME      the notebook kernel to use (default: the notebook's own)
  --dbt PATH         the dbt to use (default: the one on your PATH)
  --duckdb-path PATH dbt: the DuckDB file, if profiles.yml can't say
  --quiet            don't print the report
  -h, --help         show this

Nothing about your data leaves your machine. The report and traces hold hashes and counts, never values.
`;

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        runs: { type: 'string' }, cells: { type: 'string' }, select: { type: 'string', multiple: true },
        'static-only': { type: 'boolean' }, out: { type: 'string' }, 'fail-on': { type: 'string' },
        jupyter: { type: 'string' }, kernel: { type: 'string' }, dbt: { type: 'string' }, 'duckdb-path': { type: 'string' },
        quiet: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
      },
    });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  const v = args.values;
  if (v.version) { process.stdout.write(VERSION + '\n'); return 0; }
  if (v.help || args.positionals.length !== 1) { process.stdout.write(HELP); return v.help ? 0 : 2; }
  const runs = v.runs === undefined ? 3 : Number(v.runs);
  if (!Number.isInteger(runs) || runs < 2) { process.stderr.write('--runs needs a whole number, 2 or more.\n'); return 2; }
  const failOn = v['fail-on'] ?? 'differs';
  if (!['differs', 'never'].includes(failOn)) { process.stderr.write('--fail-on takes differs or never.\n'); return 2; }
  const select = v.select?.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  const tty = process.stderr.isTTY;
  try {
    const { report, traces } = await profile(args.positionals[0], {
      runs, cells: v.cells, select, staticOnly: v['static-only'], jupyter: v.jupyter, kernel: v.kernel, dbt: v.dbt, duckdbPath: v['duckdb-path'],
      onRun: (i, n) => { if (tty && !v.quiet) process.stderr.write(`\rRunning ${i} of ${n}…`); },
    });
    if (tty && !v.quiet) process.stderr.write('\r\u001b[K');
    const out = resolve(v.out ?? '.determinism');
    writeOutputs(out, report, traces);
    if (!v.quiet) {
      process.stdout.write(renderTerminal(report, process.stdout.isTTY));
      process.stdout.write(`Report: ${relative(process.cwd(), out) || '.'}/report.html (also report.md and report.json)\n`);
    }
    const differs = report.steps.some((s) => !s.judgment && s.verdict !== 'same' && s.verdict !== 'skipped');
    return failOn === 'differs' && differs ? 1 : 0;
  } catch (e) {
    if (tty) process.stderr.write('\r\u001b[K');
    if (e instanceof EnvError) { process.stderr.write(e.message + '\n'); return 2; }
    process.stderr.write(`Something went wrong: ${(e as Error).message}\n`);
    return 2;
  }
}

main().then((code) => process.exit(code));
