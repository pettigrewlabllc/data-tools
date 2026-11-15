/**
 * Writes labels.json: the expected join key for every pair, from the benchmark's own ground truth. Run once, before
 * the engine ever sees these files, and commit the result. It never imports the engine; the only data it reads is
 * the ground truth and a plain distinct count per matched source column.
 *
 * Rule (same for every pair): Valentine's ground truth is "source column A equals target column B", listing every
 * shared column. The join key is the matched pair whose source column identifies a row (no blanks, every value
 * different). If several qualify, any of them counts. If none does, any matched pair counts.
 *
 * Run: npx tsx fixtures/join-receipt/valentine/label.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { ensureData, joinablePairs, NYC_PAIRS, nycDir, NYC_COMMIT } from './fetch';

const HERE = dirname(fileURLToPath(import.meta.url));
interface Match { source: string; target: string }
interface Label { id: string; family: string; left: string; right: string; matches: number; rule: 'unique-source' | 'any-match'; accept: string[] }

const db = await (await DuckDBInstance.create(':memory:')).connect();
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function uniqueColumns(csv: string, cols: string[]): Promise<Set<string>> {
  const parts = cols.map((c, i) => `count(${qi(c)}) = count(*) AND count(DISTINCT ${qi(c)}) = count(*) AS u${i}`);
  const r = await db.runAndReadAll(`SELECT ${parts.join(', ')} FROM read_csv(${lit(csv)}, header = true, all_varchar = true, sample_size = -1)`);
  const row = r.getRowObjects()[0];
  return new Set(cols.filter((_, i) => row[`u${i}`] === true));
}

async function label(id: string, family: string, left: string, right: string, matches: Match[]): Promise<Label> {
  const unique = await uniqueColumns(left, [...new Set(matches.map((m) => m.source))]);
  const keys = matches.filter((m) => unique.has(m.source));
  const use = keys.length ? keys : matches;
  return {
    id, family, left, right, matches: matches.length, rule: keys.length ? 'unique-source' : 'any-match',
    accept: [...new Set(use.map((m) => `${m.source} ↔ ${m.target}`))].sort(),
  };
}

await ensureData();
const labels: Label[] = [];
for (const p of joinablePairs()) {
  const gt = JSON.parse(readFileSync(join(p.dir, `${p.id}_mapping.json`), 'utf8')) as { matches: { source_column: string; target_column: string }[] };
  labels.push(await label(p.id, `valentine-${p.source}`, join(p.dir, `${p.id}_source.csv`), join(p.dir, `${p.id}_target.csv`),
    gt.matches.map((m) => ({ source: m.source_column, target: m.target_column }))));
}
for (const pair of NYC_PAIRS) {
  const dir = nycDir(pair);
  const gt = JSON.parse(readFileSync(join(dir, 'ground_truth.json'), 'utf8')) as { matches: { source_column: string; target_column: string }[] };
  labels.push(await label(pair, 'nyc-open-data', join(dir, 'source_table.csv'), join(dir, 'target_table.csv'),
    gt.matches.map((m) => ({ source: m.source_column, target: m.target_column }))));
}

// Paths are stored relative to the cache, so the file is the same on every machine.
const rel = (s: string) => s.slice(s.indexOf('/valentine/') + '/valentine/'.length);
const out = {
  about: 'Expected join keys for the Valentine Joinable pairs and the 10 NYC Open Data pairs, written by label.ts from the benchmark ground truth before the engine ran on any of them. See label.ts for the rule and SOURCES.md for where the data comes from.',
  nycCommit: NYC_COMMIT,
  pairs: labels.map((l) => ({ ...l, left: rel(l.left), right: rel(l.right) })),
};
writeFileSync(join(HERE, 'labels.json'), JSON.stringify(out, null, 2) + '\n');
const by = (r: string) => labels.filter((l) => l.rule === r).length;
console.log(`${labels.length} pairs labelled: ${by('unique-source')} by a unique source column, ${by('any-match')} by any match`);
