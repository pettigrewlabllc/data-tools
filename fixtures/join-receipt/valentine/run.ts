/**
 * Runs the engine on every pair in labels.json and checks its top pick against the label. Downloads the data first
 * if it isn't cached. Writes ../accuracy-valentine.json. Run: npm run accuracy:valentine
 * This number is kept apart from the 20-pair real set: these pairs are halves of one table, so they're easier.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeDb } from '@data-tools/core-node';
import { loadFile, profileTable, candidatesForPair, type JoinCandidate, type TableProfile, type Db } from '@data-tools/core';
import { CACHE, ensureData } from './fetch';

const HERE = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(HERE, 'labels.json'), 'utf8')) as { pairs: { id: string; family: string; left: string; right: string; rule: string; accept: string[] }[] };

/** "a × b ↔ c × d", sorted by the left column, as in real-accuracy.ts. */
function keyLabel(c: JoinCandidate): string {
  const pairs = [{ l: c.left.column, r: c.right.column }, ...(c.also ?? []).map((p) => ({ l: p.left.column, r: p.right.column }))].sort((a, b) => a.l.localeCompare(b.l));
  return `${pairs.map((p) => p.l).join(' × ')} ↔ ${pairs.map((p) => p.r).join(' × ')}`;
}

async function load(db: Db, path: string, name: string, taken: Set<string>): Promise<TableProfile> {
  const r = await loadFile(db, name, new Uint8Array(readFileSync(join(CACHE, path))), taken);
  if (!r.ok) throw new Error(`${path}: ${r.error}`);
  return profileTable(db, r.name, r.file);
}

await ensureData();
const only = process.argv[2];
const results = [];
const t0 = Date.now();
for (const p of spec.pairs.filter((x) => !only || x.id.includes(only))) {
  const db = await createNodeDb();
  const taken = new Set<string>();
  let got = 'error', top1 = 'none', reliable = false, contain: number | null = null, score: number | null = null, reason: string | null = null, error: string | undefined;
  try {
    const lp = await load(db, p.left, 'source.csv', taken), rp = await load(db, p.right, 'target.csv', taken);
    const pr = await candidatesForPair(db, lp, rp);
    const top = pr.best[0];
    got = pr.reliable && top ? keyLabel(top) : 'none';
    top1 = top ? keyLabel(top) : 'none';
    reliable = pr.reliable;
    contain = top ? Math.round(Math.max(top.features.containLeft, top.features.containRight) * 1000) / 1000 : null;
    score = top?.score ?? null;
    reason = top?.reason ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message.split('\n')[0] : String(e);
  }
  // correct: the engine proposed this key with confidence. topPickCorrect: its best guess was right, confident or not.
  results.push({ id: p.id, family: p.family, rule: p.rule, correct: p.accept.includes(got), topPickCorrect: p.accept.includes(top1), got, top1, reliable, contain, accept: p.accept, score, reason, ...(error ? { error } : {}) });
  process.stdout.write(results.at(-1)!.correct ? '.' : 'x');
}
console.log();

const families = [...new Set(results.map((r) => r.family))];
const tally = (rs: typeof results) => ({ pairs: rs.length, correct: rs.filter((r) => r.correct).length, topPickCorrect: rs.filter((r) => r.topPickCorrect).length });
const out = {
  synthetic: false, easierThanRealJoins: true,
  ...tally(results),
  byFamily: Object.fromEntries(families.map((f) => [f, tally(results.filter((r) => r.family === f))])),
  byRule: Object.fromEntries(['unique-source', 'any-match'].map((f) => [f, tally(results.filter((r) => r.rule === f))])),
  results,
};
if (!only) writeFileSync(join(HERE, '..', 'accuracy-valentine.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`valentine pairs ${out.pairs} · proposed and right ${out.correct}/${out.pairs} · best guess right ${out.topPickCorrect}/${out.pairs} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
for (const [f, t] of Object.entries(out.byFamily)) console.log(`  ${f}: ${t.correct}/${t.pairs} (best guess ${t.topPickCorrect})`);
for (const r of results.filter((x) => !x.correct)) console.log(`  MISS ${r.id}: got ${r.got}${r.error ? ` (${r.error})` : ''} | want ${r.accept.slice(0, 2).join(' / ')}${r.accept.length > 2 ? ' …' : ''}`);
