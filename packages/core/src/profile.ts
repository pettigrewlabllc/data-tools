import type { Db } from './db';
import { ident } from './sql/quote';
import { classifyColumn, joinable, formatFamily, type FormatClass } from './formats';

export interface ColumnProfile {
  name: string; type: string; distinct: number; nulls: number; nullPct: number; unique: boolean;
  format: FormatClass; samples: string[]; minLen: number; maxLen: number;
  /** Unique integers running 0..n-1 or 1..n: a row number, not a real key. */
  rowNumber: boolean;
}
export interface TableProfile { table: string; file: string; rows: number; columns: ColumnProfile[]; grain: string[] | null }

export const SAMPLE_SIZE = 200;

export async function profileTable(db: Db, table: string, file: string): Promise<TableProfile> {
  const t = ident(table);
  const desc = await db.query(`DESCRIBE ${t}`);
  const cols = desc.map((r) => ({ name: String(r.column_name), type: String(r.column_type) }));
  const [{ n }] = await db.query(`SELECT count(*) AS n FROM ${t}`);
  const rows = Number(n);
  const parts = cols.flatMap((c, i) => {
    const q = ident(c.name);
    return [
      `count(DISTINCT ${q}) AS d${i}`,
      `count(*) - count(${q}) AS n${i}`,
      `min(length(CAST(${q} AS VARCHAR))) AS lo${i}`,
      `max(length(CAST(${q} AS VARCHAR))) AS hi${i}`,
    ];
  });
  const [stats] = cols.length ? await db.query(`SELECT ${parts.join(', ')} FROM ${t}`) : [{}];
  const columns: ColumnProfile[] = [];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const q = ident(c.name);
    // A deterministic pseudo-random sample of distinct values: order by hash, not by value.
    const sample = await db.query(
      `SELECT v FROM (SELECT DISTINCT CAST(${q} AS VARCHAR) AS v FROM ${t} WHERE ${q} IS NOT NULL) ORDER BY hash(v), v LIMIT ${SAMPLE_SIZE}`,
    );
    const samples = sample.map((r) => String(r.v));
    const distinct = Number(stats[`d${i}`]);
    const nulls = Number(stats[`n${i}`]);
    const maxLen = Number(stats[`hi${i}`] ?? 0);
    columns.push({
      name: c.name, type: c.type, distinct, nulls, nullPct: rows ? nulls / rows : 0,
      unique: rows > 0 && nulls === 0 && distinct === rows,
      format: classifyColumn({ name: c.name, type: c.type, samples, distinct, rows, maxLen }),
      samples, minLen: Number(stats[`lo${i}`] ?? 0), maxLen, rowNumber: false,
    });
  }
  for (const c of columns) {
    if (c.unique && /INT/.test(c.type)) {
      const [mm] = await db.query(`SELECT min(${ident(c.name)}) AS lo, max(${ident(c.name)}) AS hi FROM ${t}`);
      const lo = Number(mm.lo), hi = Number(mm.hi);
      c.rowNumber = (lo === 0 && hi === rows - 1) || (lo === 1 && hi === rows);
    }
  }
  const grain = await detectGrain(db, table, rows, columns);
  return { table, file, rows, columns, grain };
}

const PREFER: Record<string, number> = { id: 0, county: 1, us_state: 2, country: 2, zip: 2, email: 3, temporal: 4, text: 5 };

/** The smallest set of up to two columns that is unique per row. */
async function detectGrain(db: Db, table: string, rows: number, columns: ColumnProfile[]): Promise<string[] | null> {
  if (rows === 0) return null;
  const rank = (c: ColumnProfile) => PREFER[formatFamily(c.format)] ?? 9;
  const singles = columns.filter((c) => c.unique && joinable(c.format)).sort((a, b) => rank(a) - rank(b));
  if (singles.length) return [singles[0].name];
  const cands = columns
    .filter((c) => joinable(c.format) && c.nulls === 0 && c.distinct > 1)
    .sort((a, b) => rank(a) - rank(b) || b.distinct - a.distinct)
    .slice(0, 8);
  const pairs: [ColumnProfile, ColumnProfile][] = [];
  for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
    if (cands[i].distinct * cands[j].distinct >= rows) pairs.push([cands[i], cands[j]]);
  }
  if (!pairs.length) return null;
  const sel = pairs.map(([a, b], i) => `count(DISTINCT (${ident(a.name)}, ${ident(b.name)})) AS p${i}`).join(', ');
  const [r] = await db.query(`SELECT ${sel} FROM ${ident(table)}`);
  const hit = pairs.findIndex((_, i) => Number(r[`p${i}`]) === rows);
  return hit >= 0 ? [pairs[hit][0].name, pairs[hit][1].name] : null;
}

export function grainLabel(p: TableProfile): string {
  return p.grain ? `one row per ${p.grain.join(' × ')}` : 'no unique key found';
}
