import type { Db } from './db';
import { ident, lit } from './sql/quote';

export interface LoadedTable { ok: true; name: string; file: string; rows: number }
export interface LoadError { ok: false; file: string; error: string }

export const SUPPORTED = ['.csv', '.tsv', '.txt', '.parquet', '.json', '.ndjson', '.jsonl'];

/** A SQL-friendly table name from a file name: lower snake case, de-duplicated with _2, _3... */
export function tableNameFor(file: string, taken: Set<string>): string {
  const stem = file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  let base = stem.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'table';
  if (/^[0-9]/.test(base)) base = 't_' + base;
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  taken.add(name);
  return name;
}

function readerFor(file: string, path: string): string | null {
  const ext = file.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  const p = lit(path);
  if (ext === '.csv' || ext === '.txt') return `read_csv_auto(${p}, sample_size=-1)`;
  if (ext === '.tsv') return `read_csv_auto(${p}, sample_size=-1, delim='\\t')`;
  if (ext === '.parquet') return `read_parquet(${p})`;
  if (ext === '.json' || ext === '.ndjson' || ext === '.jsonl') return `read_json_auto(${p})`;
  return null;
}

/** Register a file and load it into its own table. A failure names the file and the reason; it never throws. */
export async function loadFile(db: Db, file: string, bytes: Uint8Array, taken: Set<string>): Promise<LoadedTable | LoadError> {
  const short = file.replace(/^.*[\\/]/, '');
  try {
    await db.registerFile(short, bytes);
    const reader = readerFor(short, db.resolve(short));
    if (!reader) return { ok: false, file: short, error: `unsupported file type (use ${SUPPORTED.join(', ')}; Excel is not supported yet)` };
    const name = tableNameFor(short, taken);
    try {
      await db.query(`CREATE OR REPLACE TABLE ${ident(name)} AS SELECT * FROM ${reader}`);
    } catch (e) {
      taken.delete(name);
      throw e;
    }
    const [{ n }] = await db.query(`SELECT count(*) AS n FROM ${ident(name)}`);
    return { ok: true, name, file: short, rows: Number(n) };
  } catch (e) {
    return { ok: false, file: short, error: firstLine(e) };
  }
}

export function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split('\n')[0].slice(0, 300);
}
