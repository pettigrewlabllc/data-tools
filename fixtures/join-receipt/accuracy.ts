/**
 * Runs the core on every labelled pair and reports top-1 accuracy per family.
 * Writes accuracy.json; the README quotes only what this file says. Run: npm run accuracy
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeDb } from '@data-tools/core-node';
import { loadFile, profileTable, candidatesForPair } from '@data-tools/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAIRS = join(HERE, process.env.JR_PAIRS ?? 'pairs');

interface Result { id: string; family: string; correct: boolean; got: string; want: string; score: number | null }
const results: Result[] = [];

for (const id of readdirSync(PAIRS).sort()) {
  const dir = join(PAIRS, id);
  const label = JSON.parse(readFileSync(join(dir, 'label.json'), 'utf8'));
  const db = await createNodeDb();
  const taken = new Set<string>();
  const profiles = [];
  for (const f of ['left.csv', 'right.csv']) {
    const r = await loadFile(db, f, new Uint8Array(readFileSync(join(dir, f))), taken);
    if (!r.ok) throw new Error(`${id}/${f}: ${r.error}`);
    profiles.push(await profileTable(db, r.name, r.file));
  }
  const pr = await candidatesForPair(db, profiles[0], profiles[1]);
  const top = pr.best[0];
  const got = pr.reliable && top ? `${top.left.column} ↔ ${top.right.column}` : 'none';
  const want = label.none ? 'none' : `${label.left.column} ↔ ${label.right.column}`;
  results.push({ id, family: label.family, correct: got === want, got, want, score: top?.score ?? null });
}

const families: Record<string, { n: number; correct: number }> = {};
for (const r of results) {
  families[r.family] ??= { n: 0, correct: 0 };
  families[r.family].n++;
  if (r.correct) families[r.family].correct++;
}
const keyed = results.filter((r) => r.want !== 'none');
const none = results.filter((r) => r.want === 'none');
const summary = {
  pairs: results.length,
  top1: keyed.filter((r) => r.correct).length / keyed.length,
  noneCorrect: none.filter((r) => r.correct).length / none.length,
  overall: results.filter((r) => r.correct).length / results.length,
  families,
  failures: results.filter((r) => !r.correct),
  synthetic: true,
};
writeFileSync(join(HERE, process.env.JR_PAIRS ? `accuracy-${process.env.JR_PAIRS}.json` : 'accuracy.json'), JSON.stringify({ seed: process.env.JR_SEED ?? '20261109', ...summary }, null, 2) + '\n');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`pairs ${summary.pairs} · top-1 on keyed pairs ${pct(summary.top1)} · "no reliable join" correct ${pct(summary.noneCorrect)} · overall ${pct(summary.overall)}`);
for (const [f, v] of Object.entries(families)) console.log(`  ${f.padEnd(10)} ${v.correct}/${v.n}`);
for (const r of summary.failures) console.log(`  MISS ${r.id}: got ${r.got} (score ${r.score}), want ${r.want}`);
