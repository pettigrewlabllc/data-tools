import type { Cause, Finding, Report, StepResult, Verdict } from '../types.js';

/** Every user-facing string the report uses, in one place (copy pending Joel's sign-off). */

export const VERDICT: Record<Verdict, string> = {
  same: 'same',
  order: 'same rows, different order',
  float: 'differs in the last few digits',
  values: 'different values',
  rows: 'different row count',
  error: 'failed in some runs',
  skipped: 'nothing to compare',
};

export const CAUSE: Record<Cause, { name: string; why: string; fix: string }> = {
  timestamp: { name: 'current time', why: 'Uses the current time, so every run gets a new value.', fix: 'Pass the date in as a parameter, or pin it.' },
  random: { name: 'random numbers', why: 'Draws random numbers with no seed.', fix: 'Set a seed before the first draw.' },
  unseeded_sample: { name: 'unseeded sample', why: 'Takes a random sample with no seed.', fix: 'Pass a seed: random_state= in pandas, REPEATABLE (n) in SQL.' },
  unordered_limit: { name: 'LIMIT without ORDER BY', why: "Which rows come back isn't defined.", fix: 'Add an ORDER BY on a unique column.' },
  ties: { name: 'ties', why: "Sorts or ranks on columns that can tie, and which row wins a tie isn't defined.", fix: 'Add a tiebreaker (an id column) to the ORDER BY.' },
  set_order: { name: 'set order', why: 'Depends on the order of a set or an unordered aggregate.', fix: 'Sort first: ORDER BY inside string_agg, sorted() in Python.' },
  float_order: { name: 'adding order', why: 'Adds up decimals in a different order each run, so the last digits move.', fix: 'Round before you compare, or sort before you sum.' },
  ai_step: { name: 'AI step', why: 'Asks a model for an answer.', fix: 'Once you trust its answers, pin them as a rule.' },
};

export const SECTION = {
  origin: { title: 'Where it starts', lede: "These steps changed even though their inputs didn't. Fix these first." },
  inherited: { title: 'Moved because of an earlier step', lede: "These changed because something upstream did. They'll settle once that's fixed." },
  inconclusive: { title: 'Inputs changed between runs', lede: "A source file or table was different between runs, so these can't be pinned on the code." },
  latent: { title: "Could vary, didn't this time", lede: '' },
  candidate: { title: 'Worth a look', lede: "These only matter if the columns you sort or rank by can tie. If they're unique, ignore them." },
  judgment: { title: 'AI steps', lede: "These ask a model for an answer, so they're expected to move. They aren't in the score." },
  notes: { title: 'Notes', lede: '' },
};

export function latentLede(runs: number): string {
  return `These can give a different answer, but they matched in all ${runs} runs.`;
}

export function headline(r: Report): string {
  if (r.static_only) return `Static check only, nothing was run. ${countFindings(r)}`;
  const { same, scored, percent } = r.score;
  if (scored === 0) return 'There were no steps to compare.';
  if (same === scored) return `Every step gave the same answer in all ${r.runs} runs.`;
  const origins = r.steps.filter((s) => s.attribution === 'origin' && !s.judgment).length;
  return `${same} of ${scored} steps gave the same answer in all ${r.runs} runs (${percent}%). ` +
    (origins ? `${origins === 1 ? 'One step starts' : `${origins} steps start`} the differences.` : "The rest moved because their inputs did.");
}

function countFindings(r: Report): string {
  const n = r.findings.filter((f) => f.kind === 'definite').length;
  return n ? `Found ${n} thing${n === 1 ? '' : 's'} that can make a run give a different answer.` : 'Found nothing that usually makes a run give a different answer.';
}

export function where(f: { file: string; line?: number; cell?: number }): string {
  if (f.cell !== undefined) return `${f.file}, cell ${f.cell}${f.line && f.line > 1 ? `, line ${f.line}` : ''}`;
  return f.line ? `${f.file}:${f.line}` : f.file;
}

export function whatMoved(s: StepResult): string {
  const parts = s.moved.map((m) => {
    const cols = m.output === 'display' || m.output.startsWith('file:') ? [] : m.columns.filter((c) => c !== '(index)');
    const name = m.output === 'display' ? 'printed output' : m.output === 'result' ? 'result' : m.output;
    return `${name}: ${VERDICT[m.verdict]}${cols.length ? ` (${cols.slice(0, 5).join(', ')}${cols.length > 5 ? ', …' : ''})` : ''}`;
  });
  return parts.join('; ') || VERDICT[s.verdict];
}

export function rowsNote(s: StepResult): string {
  const uniq = [...new Set(s.rows)];
  return uniq.length > 1 ? `rows per run: ${s.rows.join(', ')}` : '';
}

export function causeText(f: Finding): string {
  const c = CAUSE[f.cause];
  let fix = c.fix;
  if (f.cause === 'unseeded_sample') fix = f.file.endsWith('.sql') ? 'Give it a seed: REPEATABLE (n), or (bernoulli, n) in DuckDB.' : 'Pass a seed: random_state=42 or similar.';
  if (f.cause === 'set_order') fix = f.file.endsWith('.sql') ? 'Put an ORDER BY inside the aggregate.' : 'Use sorted() instead of list() on the set.';
  return `${c.name}: ${c.why} ${fix}`;
}

export function findingLine(f: Finding): string {
  return `${where(f)}  ${causeText(f)}`;
}

export const NO_CAUSE = "No known cause found in the code. Check what it reads that isn't a file or a table (an API, the clock, a global setting).";
