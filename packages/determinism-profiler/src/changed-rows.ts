import type { DuckDBConnection, DuckDBInstance, DuckDBValue } from '@duckdb/node-api';
import type { StepResult } from './types.js';

/**
 * --show-changed-rows: for a SQL or dbt step whose output differed and has a unique key, find which
 * key values differ between two runs by checksumming key ranges and bisecting the ranges that
 * disagree (the approach of reladiff's hashdiff_tables). The values found are printed to the
 * terminal only. They never go into a trace, report.json, report.md or report.html (PRD D1).
 */

/** One run's kept snapshots: step id → a table in that run's connection. Only built when the flag is on. */
export interface KeptRun {
  conn: DuckDBConnection;
  tables: Map<string, string>;
  close(): void;
}

export function keptRun(instance: DuckDBInstance, conn: DuckDBConnection): KeptRun {
  return { conn, tables: new Map(), close: () => { conn.closeSync(); instance.closeSync(); } };
}

export interface ChangedRow { key: string; change: 'only_a' | 'only_b' | 'changed' }
export type ChangedRowsResult =
  | { step_id: string; label: string; key: string; runA: number; runB: number; rows: ChangedRow[]; more: boolean }
  | { step_id: string; label: string; skipped: 'no_key' | 'not_kept' };

const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
const LIMIT = 10;
const LEAF = 64;
const FANOUT = 8;
const KEYABLE = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|VARCHAR|DATE|TIMESTAMP.*|UUID|DECIMAL.*)$/i;

async function columns(conn: DuckDBConnection, table: string) {
  const r = await conn.runAndReadAll(`DESCRIBE ${q(table)}`);
  return (r.getRowObjectsJson() as { column_name: string; column_type: string }[]).map((c) => ({ name: c.column_name, type: c.column_type }));
}

async function isUnique(conn: DuckDBConnection, table: string, col: string): Promise<boolean> {
  const r = await conn.runAndReadAll(`SELECT count(*) = count(DISTINCT ${q(col)}) AND count(${q(col)}) = count(*) AS u FROM ${q(table)}`);
  return Boolean(r.getRowObjectsJS()[0]?.u);
}

/** A single column that's unique and never null in both runs; id-looking names first. */
export async function findKey(a: DuckDBConnection, ta: string, b: DuckDBConnection, tb: string): Promise<string | null> {
  const cols = (await columns(a, ta)).filter((c) => KEYABLE.test(c.type));
  const idish = (n: string) => (/^(id|key)$|_(id|key)$|^id_|code$/i.test(n) ? 0 : 1);
  cols.sort((x, y) => idish(x.name) - idish(y.name));
  const bcols = new Set((await columns(b, tb)).map((c) => c.name));
  for (const c of cols) {
    if (!bcols.has(c.name)) continue;
    if ((await isUnique(a, ta, c.name)) && (await isUnique(b, tb, c.name))) return c.name;
  }
  return null;
}

interface Side { conn: DuckDBConnection; table: string; rowHash: string }
type Bound = DuckDBValue | null;

function where(key: string, lo: Bound, hi: Bound): { sql: string; params: DuckDBValue[] } {
  const parts: string[] = [];
  const params: DuckDBValue[] = [];
  if (lo !== null) { params.push(lo); parts.push(`${q(key)} >= $${params.length}`); }
  if (hi !== null) { params.push(hi); parts.push(`${q(key)} < $${params.length}`); }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

async function stats(s: Side, key: string, lo: Bound, hi: Bound): Promise<{ n: number; h: string }> {
  const w = where(key, lo, hi);
  const r = await s.conn.runAndReadAll(
    `SELECT count(*)::VARCHAR AS n, (coalesce(sum(${s.rowHash}::HUGEINT), 0) % 18446744073709551616)::VARCHAR AS h FROM ${q(s.table)} t ${w.sql}`, w.params);
  const row = r.getRowObjectsJson()[0] as { n: string; h: string };
  return { n: Number(row.n), h: row.h };
}

/** Up to FANOUT-1 key values that split [lo, hi) of this side into roughly equal parts. */
async function boundaries(s: Side, key: string, lo: Bound, hi: Bound, n: number): Promise<DuckDBValue[]> {
  const step = Math.max(1, Math.ceil(n / FANOUT));
  const w = where(key, lo, hi);
  const r = await s.conn.runAndReadAll(
    `SELECT k FROM (SELECT ${q(key)} AS k, row_number() OVER (ORDER BY ${q(key)}) AS rn FROM ${q(s.table)} t ${w.sql}) WHERE rn > 1 AND (rn - 1) % ${step} = 0 ORDER BY k`, w.params);
  return r.getRows().map((row) => row[0]);
}

async function leaf(s: Side, key: string, lo: Bound, hi: Bound): Promise<Map<string, string>> {
  const w = where(key, lo, hi);
  const r = await s.conn.runAndReadAll(`SELECT ${q(key)}::VARCHAR AS k, (${s.rowHash})::VARCHAR AS h FROM ${q(s.table)} t ${w.sql}`, w.params);
  return new Map((r.getRowObjectsJson() as { k: string; h: string }[]).map((x) => [x.k, x.h]));
}

/** Key values whose rows differ between two sides, up to `limit`. */
export async function diffByKey(a: Side, b: Side, key: string, limit = LIMIT): Promise<{ rows: ChangedRow[]; more: boolean }> {
  const rows: ChangedRow[] = [];
  let more = false;
  const visit = async (lo: Bound, hi: Bound): Promise<void> => {
    if (rows.length >= limit) { more = true; return; }
    const [sa, sb] = await Promise.all([stats(a, key, lo, hi), stats(b, key, lo, hi)]);
    if (sa.n === sb.n && sa.h === sb.h) return;
    if (Math.max(sa.n, sb.n) <= LEAF) {
      const [la, lb] = await Promise.all([leaf(a, key, lo, hi), leaf(b, key, lo, hi)]);
      const keys = [...new Set([...la.keys(), ...lb.keys()])].sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
      for (const k of keys) {
        const change = !lb.has(k) ? 'only_a' : !la.has(k) ? 'only_b' : la.get(k) !== lb.get(k) ? 'changed' : null;
        if (!change) continue;
        if (rows.length >= limit) { more = true; return; }
        rows.push({ key: k, change });
      }
      return;
    }
    // Split on the side with more rows in this range, so an empty side still narrows down.
    const side = sa.n >= sb.n ? a : b;
    const cuts = await boundaries(side, key, lo, hi, Math.max(sa.n, sb.n));
    const edges: Bound[] = [lo, ...cuts, hi];
    for (let i = 0; i + 1 < edges.length; i++) await visit(edges[i], edges[i + 1]);
  };
  await visit(null, null);
  return { rows, more };
}

export async function rowHashExpr(conn: DuckDBConnection, table: string): Promise<string> {
  const cols = await columns(conn, table);
  return `hash(struct_pack(${cols.map((c, i) => `c${i} := t.${q(c.name)}`).join(', ')}))`;
}

/** For each step that changed between runs, list up to 10 changed key values (or say why not). */
export async function changedRows(steps: StepResult[], runs: KeptRun[], differing: (step: string) => [number, number] | null): Promise<ChangedRowsResult[]> {
  const out: ChangedRowsResult[] = [];
  for (const s of steps) {
    if (s.judgment || s.kind === 'source' || !['values', 'rows', 'float'].includes(s.verdict)) continue;
    const pair = differing(s.step_id);
    if (!pair) continue;
    const [ia, ib] = pair;
    const ta = runs[ia]?.tables.get(s.step_id);
    const tb = runs[ib]?.tables.get(s.step_id);
    if (!ta || !tb) { out.push({ step_id: s.step_id, label: s.label, skipped: 'not_kept' }); continue; }
    const ca = runs[ia].conn;
    const cb = runs[ib].conn;
    const key = await findKey(ca, ta, cb, tb);
    if (!key) { out.push({ step_id: s.step_id, label: s.label, skipped: 'no_key' }); continue; }
    const res = await diffByKey({ conn: ca, table: ta, rowHash: await rowHashExpr(ca, ta) }, { conn: cb, table: tb, rowHash: await rowHashExpr(cb, tb) }, key);
    out.push({ step_id: s.step_id, label: s.label, key, runA: ia + 1, runB: ib + 1, ...res });
  }
  return out;
}
