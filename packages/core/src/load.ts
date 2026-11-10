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
  /** Something a person should know before trusting this table (a short row that was filled with blanks). */
  warning?: string;
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
  if (bytes.length === 0) return { ok: false, file: short, error: 'the file is empty' };
  let resolved = short;
  try {
    let sheet: SheetRange | undefined;
    let copy: LoadedTable['copy'];
    let encoding: LoadedTable['encoding'];
    let reader: string | null;
    let textForChecks: string | null = null;
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
      // Read what the checks need first: DuckDB-Wasm takes ownership of the buffer, and it's empty afterwards.
      textForChecks = /\.(csv|tsv|txt)$/i.test(short) ? new TextDecoder().decode(data.subarray(0, 5_000_000)) : null;
      await db.registerFile(short, data);
      resolved = db.resolve(short);
      reader = readerFor(short, resolved);
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
    const cols = (await db.query(`SELECT column_name AS c FROM (DESCRIBE ${ident(name)})`)).map((r) => String(r.c));
    // DuckDB gives up on a header when rows have different numbers of fields, and names the columns column0,
    // column1... Loading that would be quietly wrong, so say which line breaks the pattern instead.
    if (textForChecks && cols.every((c) => /^column\d+$/.test(c)) && /[A-Za-z]/.test(textForChecks.split(/\r?\n/)[0] ?? '')) {
      await db.query(`DROP TABLE ${ident(name)}`);
      taken.delete(name);
      const bad = raggedLine(textForChecks);
      return { ok: false, file: short, error: bad
        ? `line ${bad.line} has ${bad.got} ${bad.got === 1 ? 'field' : 'fields'}, but the header has ${bad.want}. Fix that line or export the file again.`
        : "couldn't find a header row" };
    }
    if (Number(n) === 0) {
      await db.query(`DROP TABLE ${ident(name)}`);
      taken.delete(name);
      return { ok: false, file: short, error: 'it has a header but no rows' };
    }
    let delimiter: string | undefined;
    let warning: string | undefined;
    if (textForChecks) {
      const bad = raggedLine(textForChecks);
      if (bad) warning = `Line ${bad.line} has ${bad.got} ${bad.got === 1 ? 'field' : 'fields'} and the header has ${bad.want}, so ${bad.got < bad.want ? 'the missing ones were left blank' : 'the extra ones may have been dropped'}. Check that row.`;
    }
    if (/\.(csv|txt)$/i.test(short)) {
      try {
        const [s] = await db.query(`SELECT "Delimiter" AS d FROM sniff_csv(${lit(db.resolve(short))}, sample_size=-1)`);
        if (s && typeof s.d === 'string' && s.d !== ',') delimiter = s.d;
      } catch { /* sniffing is a nicety for the pandas export; the load already worked */ }
    }
    return { ok: true, name, file: short, rows: Number(n), ...(sheet ? { sheet } : {}), ...(copy ? { copy } : {}), ...(encoding ? { encoding } : {}), ...(delimiter ? { delimiter } : {}), ...(warning ? { warning } : {}) };
  } catch (e) {
    return { ok: false, file: short, error: friendlyError(e, short, resolved) };
  }
}

/** DuckDB's errors, in words a person can act on, without temp paths. */
export function friendlyError(e: unknown, file: string, path: string): string {
  let msg = firstLine(e).split(path).join(file).replace(/"?\/[^"\s]*\/(\d+-)?/g, '"').replace(/^[A-Za-z ]*Error: /, '');
  if (/Error when sniffing file|Could not convert string .* to 'UTF8'|Invalid unicode/i.test(msg)) return "this doesn't look like a text table (CSV, TSV or pipe-delimited)";
  if (/too small to be a Parquet file|No magic bytes|not a parquet file/i.test(msg)) return "this isn't a valid Parquet file";
  const json = msg.match(/Malformed JSON.*?(at byte \d+)/i);
  if (json) return `this isn't valid JSON (it breaks ${json[1]})`;
  if (/no sheet in this workbook/i.test(msg)) return msg;
  if (/zip|central directory|end of central/i.test(msg) && /\.xlsx$/i.test(file)) return "this isn't a valid .xlsx workbook";
  msg = msg.replace(/^"+/, '');
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
}

/** The first line whose field count differs from the header's. Quote-aware; checks the first 5 MB. */
export function raggedLine(text: string): { line: number; got: number; want: number } | null {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', '\t', '|', ';'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  let want = -1, line = 1, fields = 1, quoted = false, empty = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') i++; else quoted = false; } continue; }
    if (ch === '"') { quoted = true; empty = false; } else if (ch === delim) { fields++; empty = false; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (!empty || fields > 1) {
        if (want < 0) want = fields;
        else if (fields !== want) return { line, got: fields, want };
      }
      line++; fields = 1; empty = true;
    } else empty = false;
  }
  if (!empty && want >= 0 && fields !== want) return { line, got: fields, want };
  return null;
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
