import type { Db } from './db';
import { ident, lit } from './sql/quote';
import { excelToCsv, type SheetRange } from './excel';

/** For an Excel file, `copy` is the CSV the table was read from. Exported SQL and pandas read that copy. */
export interface LoadedTable {
  ok: true; name: string; file: string; rows: number; sheet?: SheetRange; copy?: { file: string; text: string };
  /** Set when a text file wasn't UTF-8 and was read as Windows-1252 (Latin-1), as many federal CSVs are. */
  encoding?: 'windows-1252';
  /** The delimiter DuckDB detected, when it isn't a comma (Census code lists use |). */
  delimiter?: string;
}
export interface LoadError { ok: false; file: string; error: string }

export const SUPPORTED = ['.csv', '.tsv', '.txt', '.parquet', '.json', '.ndjson', '.jsonl', '.xlsx'];

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

export function readerFor(file: string, path: string, encoding?: 'windows-1252'): string | null {
  const ext = file.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  const p = lit(path);
  const enc = encoding ? `, encoding='latin-1'` : '';
  if (ext === '.csv' || ext === '.txt') return `read_csv_auto(${p}, sample_size=-1${enc})`;
  if (ext === '.tsv') return `read_csv_auto(${p}, sample_size=-1, delim='\\t'${enc})`;
  if (ext === '.parquet') return `read_parquet(${p})`;
  if (ext === '.json' || ext === '.ndjson' || ext === '.jsonl') return `read_json_auto(${p})`;
  return null;
}

/** Register a file and load it into its own table. A failure names the file and the reason; it never throws. */
export async function loadFile(db: Db, file: string, bytes: Uint8Array, taken: Set<string>): Promise<LoadedTable | LoadError> {
  const short = file.replace(/^.*[\\/]/, '');
  try {
    let sheet: SheetRange | undefined;
    let copy: LoadedTable['copy'];
    let encoding: LoadedTable['encoding'];
    let reader: string | null;
    if (/\.xls$/i.test(short)) return { ok: false, file: short, error: 'this is the old .xls format; save it as .xlsx or CSV first' };
    if (/\.xlsx$/i.test(short)) {
      // Read the workbook in JavaScript and hand DuckDB a CSV copy, so nothing depends on a DuckDB extension download.
      const t = await excelToCsv(bytes);
      sheet = t.range;
      const copyName = `${short}.csv`;
      await db.registerFile(copyName, new TextEncoder().encode(t.csv));
      reader = readerFor(copyName, db.resolve(copyName));
      copy = { file: copyName, text: t.csv };
    } else {
      // DuckDB reads UTF-8 only. Census and BLS CSVs are often Latin-1 ("Doña Ana County"), so convert those.
      let data = bytes;
      if (/\.(csv|tsv|txt|json|ndjson|jsonl)$/i.test(short) && !isUtf8(bytes)) {
        data = new TextEncoder().encode(new TextDecoder('windows-1252').decode(bytes));
        encoding = 'windows-1252';
      }
      await db.registerFile(short, data);
      reader = readerFor(short, db.resolve(short));
    }
    if (!reader) return { ok: false, file: short, error: `unsupported file type (use ${SUPPORTED.join(', ')})` };
    const name = tableNameFor(short, taken);
    try {
      await db.query(`CREATE OR REPLACE TABLE ${ident(name)} AS SELECT * FROM ${reader}`);
    } catch (e) {
      taken.delete(name);
      throw e;
    }
    const [{ n }] = await db.query(`SELECT count(*) AS n FROM ${ident(name)}`);
    let delimiter: string | undefined;
    if (/\.(csv|txt)$/i.test(short)) {
      try {
        const [s] = await db.query(`SELECT "Delimiter" AS d FROM sniff_csv(${lit(db.resolve(short))}, sample_size=-1)`);
        if (s && typeof s.d === 'string' && s.d !== ',') delimiter = s.d;
      } catch { /* sniffing is a nicety for the pandas export; the load already worked */ }
    }
    return { ok: true, name, file: short, rows: Number(n), ...(sheet ? { sheet } : {}), ...(copy ? { copy } : {}), ...(encoding ? { encoding } : {}), ...(delimiter ? { delimiter } : {}) };
  } catch (e) {
    return { ok: false, file: short, error: firstLine(e) };
  }
}

export function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split('\n')[0].slice(0, 300);
}
