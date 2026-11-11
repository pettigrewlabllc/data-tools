import type { DuckDBConnection } from '@duckdb/node-api';
import { createHash } from 'node:crypto';
import type { Fingerprint } from './fingerprint.js';

/**
 * Fingerprints computed inside DuckDB, so a 3-million-row table takes milliseconds instead of minutes
 * (measured on the NYC taxi file: 80 ms vs. several minutes row by row in Node).
 *
 * Same shape as the Node fingerprint: row count, ordered, unordered, rounded, per column.
 * Unordered = sum of row hashes mod 2^64 (duplicate-safe). Ordered = sum of hash(rowid, row hash),
 * where rowid is insertion order in a temp table, so moving a row changes it.
 */

const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
const MOD = '18446744073709551616';
const tag = (kind: string, schema: string, rows: string, v: string) =>
  createHash('sha256').update(`${kind}|${schema}|${rows}|${v}`).digest('hex').slice(0, 32);

const FLOATS = /^(DOUBLE|FLOAT|REAL|FLOAT4|FLOAT8)$/i;

async function columnsOf(conn: DuckDBConnection, relation: string): Promise<{ name: string; type: string }[]> {
  const r = await conn.runAndReadAll(`DESCRIBE SELECT * FROM ${relation}`);
  return (r.getRowObjectsJson() as { column_name: string; column_type: string }[]).map((x) => ({ name: x.column_name, type: x.column_type }));
}

/** `relation` is an already-quoted table/view reference. */
export async function fingerprintInDuckDB(conn: DuckDBConnection, relation: string, orderMatters: boolean, hasRowid = false): Promise<Fingerprint> {
  const cols = await columnsOf(conn, relation);
  const schema = JSON.stringify(cols.map((c) => [c.name, c.type]));
  const row = `hash(struct_pack(${cols.map((c, i) => `c${i} := ${q(c.name)}`).join(', ')}))`;
  const rounded = `hash(struct_pack(${cols.map((c, i) => {
    const col = q(c.name);
    const v = FLOATS.test(c.type)
      ? `CASE WHEN ${col} IS NULL OR ${col} = 0 OR NOT isfinite(${col}) THEN ${col} ELSE round(${col}, (9 - floor(log10(abs(${col}))))::INTEGER) END`
      : col;
    return `c${i} := ${v}`;
  }).join(', ')}))`;
  const sum = (e: string) => `(coalesce(sum((${e})::HUGEINT), 0) % ${MOD})::VARCHAR`;
  const parts = [
    'count(*)::VARCHAR AS n',
    `${cols.length ? sum(row) : "'0'"} AS u`,
    `${cols.length ? sum(rounded) : "'0'"} AS r`,
    hasRowid && cols.length ? `${sum(`hash(rowid, ${row})`)} AS o` : "'' AS o",
    ...cols.map((c, i) => `${sum(`hash(${q(c.name)})`)} AS col${i}`),
  ];
  const res = (await conn.runAndReadAll(`SELECT ${parts.join(', ')} FROM ${relation}`)).getRowObjectsJson()[0] as Record<string, string>;
  const n = res.n;
  const columns: Record<string, string> = {};
  cols.forEach((c, i) => (columns[c.name] = tag('c', c.name, n, res[`col${i}`])));
  const unordered = tag('u', schema, n, res.u);
  return {
    rows: Number(n),
    ordered: hasRowid ? tag('o', schema, n, res.o) : unordered,
    unordered,
    rounded: tag('r', schema, n, res.r),
    columns,
    order_matters: orderMatters,
  };
}

let seq = 0;
/** A query result, in its output order: materialised into a temp table (insertion order kept), then fingerprinted. */
export async function fingerprintQueryInDuckDB(conn: DuckDBConnection, sql: string): Promise<Fingerprint> {
  const name = `__dp_result_${++seq}`;
  await conn.run(`CREATE TEMP TABLE ${name} AS ${sql}`);
  try {
    return await fingerprintInDuckDB(conn, name, true, true);
  } finally {
    await conn.run(`DROP TABLE IF EXISTS ${name}`);
  }
}
