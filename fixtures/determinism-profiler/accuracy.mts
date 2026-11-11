/**
 * Runs every fixture with --runs 3 and scores the profiler against expected.json.
 *   npm run accuracy              → writes accuracy.json (CI fails if it changes)
 *   npm run accuracy -- --write   → rewrites each expected.json from the current output (review the diff!)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { profile } from '../../packages/determinism-profiler/src/profile.ts';
import type { Report } from '../../packages/determinism-profiler/src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '../../packages/determinism-profiler');
const venvBin = join(pkg, '.venv/bin');
const jupyter = process.env.DP_JUPYTER ?? (existsSync(join(venvBin, 'jupyter')) ? join(venvBin, 'jupyter') : undefined);
const dbt = process.env.DP_DBT ?? (existsSync(join(venvBin, 'dbt')) ? join(venvBin, 'dbt') : undefined);
const write = process.argv.includes('--write');

interface Expected {
  input: string;
  options?: { cells?: string; select?: string[] };
  origins: string[];
  inherited: string[];
  inconclusive: string[];
  findings: { at: string; cause: string; status: string }[];
  score: number;
}

const at = (f: { file: string; line: number; cell?: number }) => (f.cell !== undefined ? `cell ${f.cell}:${f.line}` : `${f.file}:${f.line}`);

function summarize(r: Report, input: string, options: Expected['options']): Expected {
  const ids = (a: string) => r.steps.filter((s) => s.attribution === a && !s.judgment).map((s) => s.step_id).sort();
  return {
    input, ...(options ? { options } : {}),
    origins: ids('origin'), inherited: ids('inherited'), inconclusive: ids('inconclusive'),
    findings: r.findings.map((f) => ({ at: at(f), cause: f.cause, status: f.status })).sort((a, b) => (a.at + a.cause).localeCompare(b.at + b.cause)),
    score: r.score.percent,
  };
}

const cases = readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(here, d.name, 'expected.json')) || (write && d.isDirectory() && /^(sql|nb|dbt)-/.test(d.name))).map((d) => d.name).sort();
let planted = 0, plantedFound = 0, attrCases = 0, attrRight = 0, fp = 0, scoreRight = 0;
const perCase: Record<string, unknown> = {};
for (const c of cases) {
  const dir = join(here, c);
  const expPath = join(dir, 'expected.json');
  const prev: Expected | undefined = existsSync(expPath) ? JSON.parse(readFileSync(expPath, 'utf8')) : undefined;
  const input = prev?.input ?? (c.startsWith('nb-') ? 'analysis.ipynb' : '.');
  const { report } = await profile(join(dir, input), { runs: 3, jupyter, dbt, cells: prev?.options?.cells, select: prev?.options?.select });
  const got = summarize(report, input, prev?.options);
  if (write || !prev) { writeFileSync(expPath, JSON.stringify(got, null, 2) + '\n'); console.log(`wrote ${c}/expected.json`); continue; }
  const confirmed = prev.findings.filter((f) => f.status === 'confirmed');
  const found = confirmed.filter((f) => got.findings.some((g) => g.at === f.at && g.cause === f.cause && g.status === 'confirmed'));
  planted += confirmed.length; plantedFound += found.length;
  const attrOk = ['origins', 'inherited', 'inconclusive'].every((k) => JSON.stringify((prev as any)[k]) === JSON.stringify((got as any)[k]));
  attrCases++; if (attrOk) attrRight++;
  // False positives: definite causes reported on a clean case.
  const caseFp = c.endsWith('-clean') ? report.findings.filter((f) => f.kind === 'definite').length : 0;
  fp += caseFp;
  const scoreOk = prev.score === got.score;
  if (scoreOk) scoreRight++;
  const findingsOk = JSON.stringify(prev.findings) === JSON.stringify(got.findings);
  perCase[c] = { planted_found: `${found.length}/${confirmed.length}`, attribution: attrOk ? 'right' : 'wrong', findings_match: findingsOk, score: got.score, ...(caseFp ? { false_positives: caseFp } : {}) };
  console.log(`${attrOk && findingsOk && scoreOk ? 'ok  ' : 'FAIL'} ${c}  causes ${found.length}/${confirmed.length}  attribution ${attrOk ? 'right' : 'WRONG'}  score ${got.score}%`);
  if (!attrOk || !findingsOk || !scoreOk) console.log('     expected', JSON.stringify(prev), '\n     got     ', JSON.stringify(got));
}
if (!write) {
  const out = {
    cases: attrCases,
    planted_causes_detected: `${plantedFound}/${planted}`,
    attribution_correct: `${attrRight}/${attrCases}`,
    clean_case_false_positives: fp,
    scores_match: `${scoreRight}/${attrCases}`,
    per_case: perCase,
  };
  writeFileSync(join(here, 'accuracy.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`\nplanted causes ${out.planted_causes_detected} · attribution ${out.attribution_correct} · clean-case false positives ${fp}`);
  if (plantedFound !== planted || attrRight !== attrCases || fp || scoreRight !== attrCases) process.exitCode = 1;
}
