/** Runs the real-data cases and writes accuracy-real.json. Skips any case whose data isn't on this machine. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { profile } from '../../../packages/determinism-profiler/src/profile.ts';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '../../../packages/determinism-profiler');
const DATA = process.env.DP_REAL_DATA ?? join(homedir(), 'Claude Code/answerability-check/heldout/data');
const bin = join(pkg, '.venv/bin');
const jupyter = process.env.DP_JUPYTER ?? (existsSync(join(bin, 'jupyter')) ? join(bin, 'jupyter') : undefined);

function link(caseDir: string, target: string): boolean {
  if (!existsSync(target)) return false;
  const l = join(here, caseDir, 'data');
  rmSync(l, { force: true });
  symlinkSync(target, l);
  return true;
}
function movielens(): string | null {
  const zip = join(DATA, '.download/movielens.zip');
  if (!existsSync(zip)) return null;
  const dir = join(tmpdir(), 'dp-movielens');
  if (!existsSync(join(dir, 'ml-latest-small/ratings.csv'))) { mkdirSync(dir, { recursive: true }); execFileSync('unzip', ['-oq', zip, '-d', dir]); }
  return join(dir, 'ml-latest-small');
}

const cases: { name: string; input: string; data: string | null; static?: boolean; expect: { origins: string[]; findings: string[] }; sometimes?: { origins: string[]; findings: string[] } }[] = [
  { name: 'chinook', input: 'chinook', data: join(DATA, 'chinook'),
    expect: { origins: ['05_genres_by_country.sql:1'], findings: ['05_genres_by_country.sql:1 set_order confirmed'] },
    // Real ties in total spent: three runs catch them only some of the time.
    sometimes: { origins: ['04_best_customer_per_country.sql:1'], findings: ['04_best_customer_per_country.sql:3 ties confirmed'] } },
  { name: 'taxi', input: 'taxi', data: join(DATA, '.download'),
    expect: { origins: ['05_sample.sql:2'], findings: ['05_sample.sql:2 unseeded_sample confirmed'] },
    // avg/sum of doubles over 3M rows, added in parallel: the last digits move on some runs.
    sometimes: { origins: ['02_by_zone.sql:1'], findings: ['02_by_zone.sql:1 float_order confirmed'] } },
  { name: 'movielens', input: 'movielens/movielens.ipynb', data: movielens(),
    expect: { origins: ['cell-4', 'cell-7'], findings: ['cell 4:3 set_order confirmed', 'cell 7:2 unseeded_sample confirmed', 'cell 9:1 unseeded_model upstream'] } },
  { name: 'pagila', input: join(DATA, 'pagila/schema.sql'), data: join(DATA, 'pagila'), static: true,
    expect: { origins: [], findings: ['schema.sql:520 set_order latent', 'schema.sql:659 set_order latent', 'schema.sql:737 set_order latent'] } },
];

const results: Record<string, unknown> = {};
let ok = 0, ran = 0;
for (const c of cases) {
  if (!c.data || (!c.static && !link(c.name, c.data)) || (c.static && !existsSync(c.input))) { results[c.name] = 'skipped: data not on this machine'; console.log(`skip ${c.name}`); continue; }
  ran++;
  const t0 = performance.now();
  const input = c.static ? c.input : join(here, c.input);
  const { report } = await profile(input, { runs: 3, staticOnly: c.static, jupyter });
  const origins = report.steps.filter((s) => s.attribution === 'origin' && !s.judgment).map((s) => s.step_id).sort();
  const findings = report.findings.filter((f) => f.status !== 'candidate').map((f) => `${f.cell !== undefined ? `cell ${f.cell}:${f.line}` : `${f.file}:${f.line}`} ${f.cause} ${f.status}`).sort();
  // Every expected item must be there; anything else must be on the case's "sometimes" list.
  const fits = (got: string[], need: string[], may: string[] = []) => need.every((x) => got.includes(x)) && got.every((x) => need.includes(x) || may.includes(x));
  const pass = fits(origins, c.expect.origins, c.sometimes?.origins) && fits(findings, c.expect.findings, c.sometimes?.findings);
  if (pass) ok++;
  results[c.name] = { pass, origins: origins.filter((x) => c.expect.origins.includes(x)), findings: findings.filter((x) => c.expect.findings.includes(x)), seconds: Math.round((performance.now() - t0) / 100) / 10 };
  const extra = [...origins, ...findings].filter((x) => !c.expect.origins.includes(x) && !c.expect.findings.includes(x));
  if (extra.length) console.log(`     this time also: ${extra.join(', ')}`);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${c.name}${pass ? '' : `\n     expected ${JSON.stringify(c.expect)}\n     got      ${JSON.stringify({ origins, findings })}`}`);
}
// Timings vary by machine, so they're printed, not stored.
const stored = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, typeof v === 'object' && v ? { ...(v as object), seconds: undefined } : v]));
writeFileSync(join(here, '../accuracy-real.json'), JSON.stringify({ cases_run: ran, passed: ok, results: stored }, null, 2) + '\n');
console.log(`\n${ok}/${ran} real-data cases as expected`);
if (ok !== ran) process.exitCode = 1;
