/**
 * Loading samples. JSON.parse turns 12345678901234567890 into 12345678901234567000 without a word, and many
 * APIs' ids are that size, so this parser reads any integer outside ±2^53 as its digits (a string) and
 * remembers where it found one. Everything else matches JSON.parse.
 */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface ParseResult { value: Json; bigIntPaths: Set<string> }

export function parseJson(text: string): ParseResult {
  let i = 0;
  const big = new Set<string>();
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const err = (msg: string): never => {
    const line = text.slice(0, i).split('\n').length;
    throw new Error(`${msg} at line ${line}`);
  };
  const value = (path: string): Json => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++; const o: Record<string, Json> = {}; ws();
      if (text[i] === '}') { i++; return o; }
      for (;;) {
        ws(); if (text[i] !== '"') err('expected a key');
        const k = str(); ws(); if (text[i++] !== ':') err('expected ":"');
        o[k] = value(path ? `${path}.${k}` : k); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return o; }
        err('expected "," or "}"');
      }
    }
    if (c === '[') {
      i++; const a: Json[] = []; ws();
      if (text[i] === ']') { i++; return a; }
      for (;;) {
        a.push(value(`${path}[]`)); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return a; }
        err('expected "," or "]"');
      }
    }
    if (c === '"') return str();
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    const m = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/y; m.lastIndex = i;
    const r = m.exec(text);
    if (!r) return err('unexpected character');
    i = m.lastIndex;
    const s = r[0];
    if (!r[1] && !r[2]) {
      const n = Number(s);
      if (!Number.isSafeInteger(n)) { big.add(path); return s; }
      return n;
    }
    return Number(s);
  };
  const str = (): string => {
    const start = i; i++;
    let simple = true;
    while (i < text.length && text[i] !== '"') { if (text[i] === '\\') { simple = false; i++; } i++; }
    if (i >= text.length) err('unterminated string');
    i++;
    const raw = text.slice(start, i);
    return simple ? raw.slice(1, -1) : JSON.parse(raw);
  };
  const v = value('');
  ws();
  if (i < text.length) err('unexpected text after the JSON');
  return { value: v, bigIntPaths: big };
}

export interface LoadedFile { name: string; records: Json[]; recordRoot: string[] | null; bigIntPaths: string[] }
export interface LoadError { name: string; reason: string }

export const MAX_FILES = 50;
export const MAX_BYTES = 50 * 1024 * 1024;

const isObj = (v: Json | undefined): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Where the records are. A top-level array is the records. An object with exactly one key holding a non-empty
 * array of objects (GeoJSON `features`, `{ "data": [...] }`) is an envelope, and that array is the records.
 * Anything else is one record.
 */
export function findRecordRoot(v: Json): string[] | null {
  if (!isObj(v)) return null;
  const arrays = Object.entries(v).filter(([, x]) => Array.isArray(x) && x.length > 0 && x.every(isObj));
  return arrays.length === 1 ? [arrays[0][0]] : null;
}

function strip(paths: Set<string>, root: string[] | null): string[] {
  const prefix = root ? `${root.join('.')}[]` : '[]';
  return [...paths].map((p) => (p.startsWith(prefix) ? p.slice(prefix.length).replace(/^\./, '') : p)).sort();
}

/** One file or pasted text: a JSON value, or NDJSON (one JSON value per line). */
export function loadText(name: string, text: string, recordRoot?: string[] | null): LoadedFile {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('the file is empty');
  let docs: ParseResult[];
  try {
    docs = [parseJson(trimmed)];
  } catch (e) {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw e;
    try { docs = lines.map((l) => parseJson(l)); } catch (e2) { throw new Error(`not JSON or NDJSON: ${(e as Error).message}`); }
  }
  const records: Json[] = [];
  const big = new Set<string>();
  let root: string[] | null = recordRoot === undefined ? null : recordRoot;
  for (const d of docs) {
    const r = recordRoot === undefined ? (docs.length === 1 ? findRecordRoot(d.value) : null) : recordRoot;
    if (recordRoot === undefined && docs.length === 1) root = r;
    let v: Json | undefined = d.value;
    for (const k of r ?? []) v = isObj(v) ? v[k] : undefined;
    if (Array.isArray(v)) records.push(...v);
    else if (v !== undefined) records.push(v);
    for (const p of strip(d.bigIntPaths, r)) big.add(p);
  }
  const bad = records.findIndex((r) => !isObj(r));
  if (records.length === 0) throw new Error('no records in the file');
  if (bad >= 0) throw new Error(`record ${bad + 1} is not an object`);
  return { name, records, recordRoot: root, bigIntPaths: [...big].sort() };
}

export interface LoadResult { files: LoadedFile[]; errors: LoadError[]; records: Json[]; bigIntPaths: string[] }

export function loadFiles(files: { name: string; text: string }[]): LoadResult {
  const errors: LoadError[] = [];
  const loaded: LoadedFile[] = [];
  if (files.length > MAX_FILES) return { files: [], errors: [{ name: `${files.length} files`, reason: `at most ${MAX_FILES} files at once` }], records: [], bigIntPaths: [] };
  const total = files.reduce((n, f) => n + f.text.length, 0);
  if (total > MAX_BYTES) return { files: [], errors: [{ name: `${files.length} files`, reason: 'more than 50 MB in total' }], records: [], bigIntPaths: [] };
  for (const f of files) {
    try { loaded.push(loadText(f.name, f.text)); } catch (e) { errors.push({ name: f.name, reason: (e as Error).message }); }
  }
  const big = new Set(loaded.flatMap((f) => f.bigIntPaths));
  return { files: loaded, errors, records: loaded.flatMap((f) => f.records), bigIntPaths: [...big].sort() };
}
