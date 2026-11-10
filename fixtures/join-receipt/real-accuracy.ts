/**
 * Runs the core on the real public files in real/ and checks the top proposal against real/pairs.json.
 * Unlike accuracy.ts, nobody generated these files, so this is the number to quote about real data.
 * Writes accuracy-real.json, including each top pick's receipt. Run: npm run accuracy:real
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeDb } from '@data-tools/core-node';
import { loadFile, profileTable, candidatesForPair, buildReceipt, describePattern, type JoinCandidate, type TableProfile, type Db } from '@data-tools/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = join(HERE, 'real');
const spec = JSON.parse(readFileSync(join(REAL, 'pairs.json'), 'utf8')) as {
  pairs: { id: string; family: string; left: string; right: string; accept: string[]; note?: string }[];
};

/** "a × b ↔ c × d", key pairs sorted by the left column so the order the engine found them in doesn't matter. */
export function keyLabel(c: JoinCandidate): string {
  const pairs = [{ l: c.left.column, r: c.right.column }, ...(c.also ?? []).map((p) => ({ l: p.left.column, r: p.right.column }))]
    .sort((a, b) => a.l.localeCompare(b.l));
  return `${pairs.map((p) => p.l).join(' × ')} ↔ ${pairs.map((p) => p.r).join(' × ')}`;
}

async function load(db: Db, file: string, taken: Set<string>): Promise<TableProfile> {
  const r = await loadFile(db, file, new Uint8Array(readFileSync(join(REAL, 'files', file))), taken);
  if (!r.ok) throw new Error(`${file}: ${r.error}`);
  return profileTable(db, r.name, r.file);
}

const results = [];
for (const p of spec.pairs) {
  const db = await createNodeDb();
  const taken = new Set<string>();
  const lp = await load(db, p.left, taken), rp = await load(db, p.right, taken);
  const pr = await candidatesForPair(db, lp, rp);
  const top = pr.best[0];
  const got = pr.reliable && top ? keyLabel(top) : 'none';
  let receipt = null;
  if (top) {
    const r = await buildReceipt(db, [lp, rp], { join: { op: 'join_on', how: 'left', left: top.left, right: top.right, ...(top.also ? { also: top.also } : {}) } });
    receipt = {
      matched: `${r.matchedLeft} of ${r.leftRows}`, matchRateBefore: r.matchRateBefore, matchRateAfter: r.matchRateAfter,
      leftOver: `${r.unmatchedRight} of ${r.rightRows}`, fanout: Math.round(r.fanout * 100) / 100, fanoutWarning: r.fanoutWarning,
      cleanup: r.normalisations || null,
      patternsLeft: r.patternsLeft.map(describePattern), patternsRight: r.patternsRight.map(describePattern),
    };
  }
  results.push({ id: p.id, family: p.family, correct: p.accept.includes(got), got, accept: p.accept, score: top?.score ?? null, reason: top?.reason ?? null, receipt });
}

const correct = results.filter((r) => r.correct).length;
const out = { synthetic: false, pairs: results.length, correct, top1: correct / results.length, results };
writeFileSync(join(HERE, 'accuracy-real.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`real pairs ${results.length} · top-1 ${correct}/${results.length}`);
for (const r of results) {
  console.log(`  ${r.correct ? 'ok  ' : 'MISS'} ${r.id}: ${r.got} (score ${r.score})`);
  if (r.receipt) console.log(`       matched ${r.receipt.matched}, left over ${r.receipt.leftOver}, fan-out ${r.receipt.fanout}${r.receipt.cleanup ? `, cleanup: ${r.receipt.cleanup}` : ''}`);
  for (const t of [...(r.receipt?.patternsLeft ?? []), ...(r.receipt?.patternsRight ?? [])]) console.log(`       ${t}`);
}
