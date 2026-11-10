/**
 * The closed grammar. Rules, people and models all describe a join with these types, and nothing else
 * is ever turned into SQL. A model's answer is untrusted JSON until one of the validators accepts it.
 */
export type CodeKind = 'name' | 'abbr' | 'fips' | 'iso2' | 'iso3';
export type CrosswalkTable = 'us_state' | 'country';

export type Transform =
  | { op: 'trim' }
  | { op: 'lower' }
  | { op: 'upper' }
  | { op: 'lpad'; width: number; fill: string }
  | { op: 'crosswalk'; table: CrosswalkTable; from: CodeKind; to: CodeKind }
  | { op: 'cast'; to: 'varchar' | 'integer' | 'date' }
  | { op: 'date_trunc'; unit: 'day' | 'month' | 'year' };

export interface KeyRef {
  table: string;
  column: string;
  transforms: Transform[];
}

export interface JoinOn {
  op: 'join_on';
  left: KeyRef;
  right: KeyRef;
  how: 'inner' | 'left';
}

export type AggFn = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first';
export const AGG_FNS: AggFn[] = ['sum', 'avg', 'min', 'max', 'count', 'first'];

export interface Aggregate {
  op: 'aggregate';
  table: string;
  by: string[];
  measures: { column: string; fn: AggFn }[];
}

export type Schema = Record<string, string[]>;
export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_TRANSFORMS = 6;
export const CROSSWALK_KINDS: Record<CrosswalkTable, CodeKind[]> = {
  us_state: ['name', 'abbr', 'fips'],
  country: ['name', 'iso2', 'iso3'],
};
export const ALLOWED_OPS = ['trim', 'lower', 'upper', 'lpad', 'crosswalk', 'cast', 'date_trunc'] as const;

const ok = <T>(value: T): Validated<T> => ({ ok: true, value });
const fail = <T>(error: string): Validated<T> => ({ ok: false, error });

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function exactKeys(o: Record<string, unknown>, keys: string[]): string | null {
  const extra = Object.keys(o).filter((k) => !keys.includes(k));
  if (extra.length) return `unexpected field "${extra[0]}"`;
  const missing = keys.filter((k) => !(k in o));
  if (missing.length) return `missing field "${missing[0]}"`;
  return null;
}

export function validateTransform(x: unknown): Validated<Transform> {
  if (!isObj(x)) return fail('a transform must be an object');
  const op = x.op;
  if (typeof op !== 'string' || !(ALLOWED_OPS as readonly string[]).includes(op)) {
    return fail(`"${String(op)}" is not an allowed operation (allowed: ${ALLOWED_OPS.join(', ')})`);
  }
  switch (op) {
    case 'trim':
    case 'lower':
    case 'upper': {
      const e = exactKeys(x, ['op']);
      return e ? fail(e) : ok({ op } as Transform);
    }
    case 'lpad': {
      const e = exactKeys(x, ['op', 'width', 'fill']);
      if (e) return fail(e);
      const { width, fill } = x;
      if (typeof width !== 'number' || !Number.isInteger(width) || width < 1 || width > 20) {
        return fail('lpad width must be a whole number from 1 to 20');
      }
      if (typeof fill !== 'string' || !/^[0-9A-Za-z _-]$/.test(fill)) {
        return fail('lpad fill must be one letter, digit, space, underscore or hyphen');
      }
      return ok({ op: 'lpad', width, fill });
    }
    case 'crosswalk': {
      const e = exactKeys(x, ['op', 'table', 'from', 'to']);
      if (e) return fail(e);
      const { table, from, to } = x;
      if (table !== 'us_state' && table !== 'country') return fail('crosswalk table must be us_state or country');
      const kinds = CROSSWALK_KINDS[table];
      if (!kinds.includes(from as CodeKind) || !kinds.includes(to as CodeKind)) {
        return fail(`crosswalk ${table} supports ${kinds.join(', ')}`);
      }
      if (from === to) return fail('crosswalk from and to must differ');
      return ok({ op: 'crosswalk', table, from: from as CodeKind, to: to as CodeKind });
    }
    case 'cast': {
      const e = exactKeys(x, ['op', 'to']);
      if (e) return fail(e);
      if (x.to !== 'varchar' && x.to !== 'integer' && x.to !== 'date') return fail('cast to must be varchar, integer or date');
      return ok({ op: 'cast', to: x.to });
    }
    case 'date_trunc': {
      const e = exactKeys(x, ['op', 'unit']);
      if (e) return fail(e);
      if (x.unit !== 'day' && x.unit !== 'month' && x.unit !== 'year') return fail('date_trunc unit must be day, month or year');
      return ok({ op: 'date_trunc', unit: x.unit });
    }
  }
  return fail('unreachable');
}

export function validateTransforms(x: unknown): Validated<Transform[]> {
  if (!Array.isArray(x)) return fail('transforms must be a list');
  if (x.length > MAX_TRANSFORMS) return fail(`at most ${MAX_TRANSFORMS} transforms per key`);
  const out: Transform[] = [];
  for (const t of x) {
    const v = validateTransform(t);
    if (!v.ok) return v;
    out.push(v.value);
  }
  return ok(out);
}

function validateKeyRef(x: unknown, schema: Schema): Validated<KeyRef> {
  if (!isObj(x)) return fail('a key must be an object');
  const e = exactKeys(x, ['table', 'column', 'transforms']);
  if (e) return fail(e);
  const { table, column } = x;
  if (typeof table !== 'string' || !Object.hasOwn(schema, table)) return fail(`unknown table "${String(table)}"`);
  if (typeof column !== 'string' || !schema[table].includes(column)) return fail(`unknown column "${String(column)}" in ${table}`);
  const t = validateTransforms(x.transforms);
  if (!t.ok) return t;
  return ok({ table, column, transforms: t.value });
}

export function validateJoinOn(x: unknown, schema: Schema): Validated<JoinOn> {
  if (!isObj(x)) return fail('join_on must be an object');
  const e = exactKeys(x, ['op', 'left', 'right', 'how']);
  if (e) return fail(e);
  if (x.op !== 'join_on') return fail('op must be join_on');
  if (x.how !== 'inner' && x.how !== 'left') return fail('how must be inner or left');
  const l = validateKeyRef(x.left, schema);
  if (!l.ok) return l;
  const r = validateKeyRef(x.right, schema);
  if (!r.ok) return r;
  if (l.value.table === r.value.table) return fail('a join needs two different tables');
  return ok({ op: 'join_on', left: l.value, right: r.value, how: x.how });
}

export function validateAggregate(x: unknown, schema: Schema): Validated<Aggregate> {
  if (!isObj(x)) return fail('aggregate must be an object');
  const e = exactKeys(x, ['op', 'table', 'by', 'measures']);
  if (e) return fail(e);
  if (x.op !== 'aggregate') return fail('op must be aggregate');
  const table = x.table;
  if (typeof table !== 'string' || !Object.hasOwn(schema, table)) return fail(`unknown table "${String(table)}"`);
  const cols = schema[table];
  if (!Array.isArray(x.by) || x.by.length === 0 || !x.by.every((c) => typeof c === 'string' && cols.includes(c))) {
    return fail('aggregate by must list existing columns');
  }
  if (!Array.isArray(x.measures)) return fail('measures must be a list');
  const measures: Aggregate['measures'] = [];
  for (const m of x.measures) {
    if (!isObj(m)) return fail('each measure must be an object');
    const me = exactKeys(m, ['column', 'fn']);
    if (me) return fail(me);
    if (typeof m.column !== 'string' || !cols.includes(m.column)) return fail(`unknown column "${String(m.column)}"`);
    if (!AGG_FNS.includes(m.fn as AggFn)) return fail(`"${String(m.fn)}" is not an allowed aggregate`);
    measures.push({ column: m.column, fn: m.fn as AggFn });
  }
  return ok({ op: 'aggregate', table, by: x.by as string[], measures });
}
