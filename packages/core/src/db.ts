export type Row = Record<string, unknown>;

/** The one thing the core needs from a database engine. DuckDB-Wasm and DuckDB node both implement it. */
export interface Db {
  /** Run SQL and return rows as plain JS values (BigInt becomes number when safe, else string; dates become ISO strings). */
  query(sql: string): Promise<Row[]>;
  /** Make a file's bytes readable from SQL. */
  registerFile(name: string, bytes: Uint8Array): Promise<void>;
  /** The path to use inside SQL for a registered file. */
  resolve(name: string): string;
}

/** Shared value normaliser so both adapters return identical shapes. */
export function plainValue(v: unknown): unknown {
  if (typeof v === 'bigint') {
    return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v.toString();
  }
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (Array.isArray(v)) return v.map(plainValue);
  return v;
}

export function plainRow(r: Record<string, unknown>): Row {
  const out: Row = {};
  for (const k of Object.keys(r)) out[k] = plainValue(r[k]);
  return out;
}
