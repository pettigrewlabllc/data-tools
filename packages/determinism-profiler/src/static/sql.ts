import type { Finding } from '../types.js';

export interface Token {
  kind: 'word' | 'punct' | 'string' | 'ident' | 'number';
  text: string; // lower-cased for words
  line: number;
  depth: number; // parenthesis depth before this token
}

export interface Statement {
  text: string;
  line: number; // line of the first token
  tokens: Token[];
}

/**
 * Splits SQL into statements and tokens in one pass. Comments are dropped; strings, quoted
 * identifiers and $$ blocks are kept whole, so a ';' or 'limit' inside them is never seen.
 */
export function splitStatements(sql: string, firstLine = 1): Statement[] {
  const out: Statement[] = [];
  let tokens: Token[] = [];
  let start = 0;
  let line = firstLine;
  let depth = 0;
  let i = 0;
  const push = (kind: Token['kind'], text: string, l: number) => tokens.push({ kind, text, line: l, depth });
  const flush = (end: number) => {
    if (tokens.length) out.push({ text: sql.slice(start, end).trim(), line: tokens[0].line, tokens });
    tokens = [];
    depth = 0;
    start = end + 1;
  };
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && n === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) { if (sql[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const l = line;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c && sql[j + 1] === c) { j += 2; continue; }
        if (sql[j] === c) break;
        if (sql[j] === '\n') line++;
        j++;
      }
      push(c === "'" ? 'string' : 'ident', sql.slice(i + 1, j).replaceAll(c + c, c), l);
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_]*)\$/.exec(sql.slice(i));
      if (m) {
        const close = sql.indexOf(m[0], i + m[0].length);
        const end = close < 0 ? sql.length : close;
        const body = sql.slice(i + m[0].length, end);
        push('string', body, line);
        line += body.split('\n').length - 1;
        i = end + m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
      push('word', sql.slice(i, j).toLowerCase(), line);
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(n ?? ''))) {
      let j = i + 1;
      while (j < sql.length && /[0-9.eE]/.test(sql[j])) j++;
      push('number', sql.slice(i, j), line);
      i = j;
      continue;
    }
    if (c === ';') { flush(i); i++; continue; }
    if (c === '(') { push('punct', c, line); depth++; i++; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); push('punct', c, line); i++; continue; }
    push('punct', c, line);
    i++;
  }
  flush(sql.length);
  return out;
}

const TIMESTAMP_CALLS = new Set(['now', 'today', 'get_current_time', 'get_current_timestamp', 'transaction_timestamp', 'current_localtimestamp']);
const TIMESTAMP_WORDS = new Set(['current_timestamp', 'current_date', 'current_time', 'localtimestamp', 'localtime']);
const RANDOM_CALLS = new Set(['random', 'uuid', 'gen_random_uuid', 'uuidv4', 'uuidv7']);
const ORDERED_AGGS = new Set(['string_agg', 'array_agg', 'list', 'group_concat', 'listagg', 'array_to_string_agg']);
const ARBITRARY_AGGS = new Set(['first', 'last', 'any_value', 'arbitrary']);
const CLAUSE_END = new Set(['where', 'group', 'order', 'limit', 'having', 'qualify', 'window', 'union', 'except', 'intersect', 'join', 'left', 'right', 'inner', 'full', 'cross', 'on']);

/** Index of the ')' that closes the '(' at tokens[open]. */
function closeParen(t: Token[], open: number): number {
  for (let k = open + 1; k < t.length; k++) if (t[k].text === ')' && t[k].depth === t[open].depth) return k;
  return t.length - 1;
}

export interface SqlCheckState {
  seeded: boolean; // setseed() seen earlier in run order
}

/** Static checks over one statement. `file` and `step` tie findings to a place and a step. */
export function checkStatement(st: Statement, file: string, step: string, state: SqlCheckState): Finding[] {
  const t = st.tokens;
  const f: Finding[] = [];
  const add = (cause: Finding['cause'], tok: Token, kind: Finding['kind']) =>
    f.push({ file, line: tok.line, cause, keyword: tok.text, kind, step, status: 'pending' });
  const call = (k: number) => t[k + 1]?.text === '(';

  for (let k = 0; k < t.length; k++) {
    const tok = t[k];
    if (tok.kind !== 'word') continue;
    const w = tok.text;
    if (w === 'setseed' && call(k)) state.seeded = true;
    else if (TIMESTAMP_CALLS.has(w) && call(k)) add('timestamp', tok, 'definite');
    else if (TIMESTAMP_WORDS.has(w)) add('timestamp', tok, 'definite');
    else if (RANDOM_CALLS.has(w) && call(k) && !(w === 'random' && state.seeded)) add('random', tok, 'definite');
    else if ((w === 'sample' && t[k - 1]?.text === 'using') || w === 'tablesample') {
      // Seeded forms: REPEATABLE (n), or DuckDB's "10% (bernoulli, 42)".
      let seeded = false;
      for (let j = k + 1; j < t.length && t[j].depth >= tok.depth; j++) {
        if (t[j].depth === tok.depth && CLAUSE_END.has(t[j].text)) break;
        if (t[j].text === 'repeatable') { seeded = true; break; }
        if (t[j].text === ',' && t[j + 1]?.kind === 'number') { seeded = true; break; }
      }
      if (!seeded) add('unseeded_sample', w === 'sample' ? t[k - 1] : tok, 'definite');
    } else if (ORDERED_AGGS.has(w) && call(k)) {
      const end = closeParen(t, k + 1);
      const inner = t.slice(k + 2, end);
      if (!inner.some((x) => x.text === 'order')) add('set_order', tok, 'definite');
    } else if (ARBITRARY_AGGS.has(w) && call(k)) {
      const end = closeParen(t, k + 1);
      if (!t.slice(k + 2, end).some((x) => x.text === 'order')) add('set_order', tok, 'definite');
    } else if (w === 'row_number' && call(k)) {
      // ROW_NUMBER() OVER (... ORDER BY ...): which row gets 1 is arbitrary when the ORDER BY has ties.
      const over = closeParen(t, k + 1) + 1;
      if (t[over]?.text === 'over' && t[over + 1]?.text === '(') add('ties', tok, 'candidate');
    } else if (w === 'limit') {
      // Walk back at this depth to the SELECT this LIMIT belongs to.
      let ordered = false;
      for (let j = k - 1; j >= 0; j--) {
        if (t[j].depth < tok.depth) break;
        if (t[j].depth !== tok.depth) continue;
        if (t[j].text === 'order' && t[j + 1]?.text === 'by') { ordered = true; break; }
        if (t[j].text === 'select') break;
      }
      if (!ordered) add('unordered_limit', tok, 'candidate');
      else add('ties', tok, 'candidate');
    }
  }
  return f;
}

/** What a statement does, for the step model. */
export interface StatementShape {
  kind: 'relation' | 'mutation' | 'result' | 'copy' | 'other';
  target?: string; // table/view name for relation and mutation
  view?: boolean;
  query?: string; // the query part, for parent detection
  copyTo?: string;
}

export function shapeOf(st: Statement): StatementShape {
  const t = st.tokens;
  const w = (k: number) => t[k]?.text;
  const nameAt = (k: number): [string, number] => {
    // name or schema.name, possibly quoted
    let name = t[k]?.text ?? '';
    let j = k + 1;
    while (w(j) === '.' && t[j + 1]) { name = t[j + 1].text; j += 2; }
    return [name, j];
  };
  const queryFrom = (k: number) => {
    const tok = t[k];
    if (!tok) return undefined;
    const lines = st.text.split('\n');
    const rel = tok.line - st.line;
    // Re-find the token text on its line; good enough for parent detection.
    const lineText = lines[rel] ?? '';
    const idx = lineText.toLowerCase().indexOf(tok.text);
    return [lineText.slice(Math.max(0, idx)), ...lines.slice(rel + 1)].join('\n');
  };
  if (w(0) === 'create') {
    let k = 1;
    if (w(k) === 'or' && w(k + 1) === 'replace') k += 2;
    while (['temp', 'temporary', 'local', 'global', 'unlogged'].includes(w(k) ?? '')) k++;
    const isView = w(k) === 'view';
    if (w(k) === 'table' || isView) {
      k++;
      if (w(k) === 'if' && w(k + 1) === 'not' && w(k + 2) === 'exists') k += 3;
      const [name, j] = nameAt(k);
      let as = j;
      while (as < t.length && !(w(as) === 'as' && t[as].depth === 0)) as++;
      if (as < t.length) return { kind: 'relation', target: name, view: isView, query: queryFrom(as + 1) };
      return { kind: 'other' };
    }
    return { kind: 'other' };
  }
  if (w(0) === 'insert' && w(1) === 'into') {
    const [name, j] = nameAt(2);
    let q = j;
    while (q < t.length && !['select', 'with', 'values', 'from'].includes(w(q) ?? '')) q++;
    return { kind: 'mutation', target: name, query: queryFrom(q) };
  }
  if (w(0) === 'update') return { kind: 'mutation', target: nameAt(1)[0] };
  if (w(0) === 'delete' && w(1) === 'from') return { kind: 'mutation', target: nameAt(2)[0] };
  if (['select', 'with', 'from', 'values', 'table', 'pivot', 'unpivot', 'summarize', 'describe'].includes(w(0) ?? '') || w(0) === '(') {
    return { kind: 'result', query: st.text };
  }
  if (w(0) === 'copy') {
    const to = t.findIndex((x, k) => x.text === 'to' && x.depth === 0 && k > 0);
    if (to > 0 && t[to + 1]?.kind === 'string') {
      const q = w(1) === '(' ? queryFrom(2) : undefined;
      return { kind: 'copy', copyTo: t[to + 1].text, query: q, target: w(1) === '(' ? undefined : t[1].text };
    }
  }
  return { kind: 'other' };
}

/** Table names and file paths a statement reads, by token scan (DuckDB's parser refines tables at run time). */
export function referencesOf(st: Statement): { tables: string[]; files: string[] } {
  const t = st.tokens;
  const tables = new Set<string>();
  const files = new Set<string>();
  for (let k = 0; k < t.length; k++) {
    const x = t[k];
    if (x.kind === 'string' && /\.(csv|tsv|parquet|json|jsonl|ndjson|txt|xlsx)(\.gz)?$/i.test(x.text)) files.add(x.text);
    if ((x.text === 'from' || x.text === 'join') && t[k + 1]) {
      let j = k + 1;
      if (t[j].kind === 'word' || t[j].kind === 'ident') {
        let name = t[j].text;
        while (t[j + 1]?.text === '.' && t[j + 2]) { name = t[j + 2].text; j += 2; }
        if (t[j + 1]?.text !== '(' && !['select', 'lateral', 'unnest'].includes(name)) tables.add(name);
      }
    }
  }
  // Names defined by WITH name AS (...) in this statement aren't tables from earlier steps.
  for (let k = 1; k + 2 < t.length; k++) {
    if ((t[k].kind === 'word' || t[k].kind === 'ident') && t[k + 1].text === 'as' && t[k + 2].text === '(' &&
        ['with', ',', 'recursive'].includes(t[k - 1].text)) tables.delete(t[k].text);
  }
  return { tables: [...tables], files: [...files] };
}
