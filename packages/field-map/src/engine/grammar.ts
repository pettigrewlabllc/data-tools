/**
 * The closed grammar. Every mapping, whether a rule, a person or a model proposed it, is described with these
 * types and nothing else, and only `validateMapping` lets one in. See docs/adr/0005-field-map-grammar.md.
 *
 * A path is a list of object keys. Arrays never appear inside a `path`; they are handled by the ops that
 * expect them (`values`, `pick`, `count`, `nested`), so every op's output shape is known ahead of time.
 */
export type Path = string[];
export type Scalar = string | number | boolean | null;

export type DateFrom = 'iso' | 'epoch_s' | 'epoch_ms' | 'epoch_us' | 'epoch_ns' | 'us_date';
export type CastTo = 'string' | 'integer' | 'number' | 'boolean';

export type Transform =
  | { op: 'trim' }
  | { op: 'lower' }
  | { op: 'upper' }
  | { op: 'cast'; to: CastTo }
  | { op: 'parse_date'; from: DateFrom; out: 'date' | 'date-time' }
  | { op: 'scale'; power: number }
  | { op: 'value_map'; map: Record<string, Scalar>; builtin?: string };

export type Which = 'first' | 'last' | { key: Path; equals: Scalar };

export type Source =
  | { op: 'path'; path: Path }
  | { op: 'coalesce'; paths: Path[] }
  | { op: 'concat'; paths: Path[]; sep: string }
  | { op: 'pick'; array: Path; which: Which; field: Path }
  | { op: 'values'; array: Path; field: Path }
  | { op: 'count'; array: Path }
  | { op: 'constant'; value: Scalar }
  | { op: 'nested'; array: Path; fields: FieldMapping[] };

/** One target field. `target` is relative to its context: the record, or the item of the parent `nested`. */
export interface FieldMapping {
  target: Path;
  source: Source;
  transforms: Transform[];
}

export const MAX_OPS = 5;
export const SOURCE_OPS = ['path', 'coalesce', 'concat', 'pick', 'values', 'count', 'constant', 'nested'] as const;
export const TRANSFORM_OPS = ['trim', 'lower', 'upper', 'cast', 'parse_date', 'scale', 'value_map'] as const;
export const DATE_FROM: DateFrom[] = ['iso', 'epoch_s', 'epoch_ms', 'epoch_us', 'epoch_ns', 'us_date'];
export const CAST_TO: CastTo[] = ['string', 'integer', 'number', 'boolean'];

export function showPath(p: Path): string {
  return p.map((k) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : JSON.stringify(k))).join('.');
}

/** `a.b` → ['a','b']; quoted segments ("first name") allowed. Used for paths people type. */
export function parsePath(s: string): Path {
  const out: string[] = [];
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|([^."]+))\s*(?:\.|$)/y;
  let m: RegExpExecArray | null;
  while (re.lastIndex < s.length && (m = re.exec(s))) out.push(m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : m[2].trim());
  if (re.lastIndex < s.length || out.some((k) => k === '')) throw new Error(`can't read the path "${s}"`);
  return out;
}

export function opCount(f: FieldMapping): number {
  const own = 1 + f.transforms.length;
  return f.source.op === 'nested' ? own + f.source.fields.reduce((n, c) => n + opCount(c), 0) : own;
}

const isPath = (p: unknown): p is Path => Array.isArray(p) && p.length > 0 && p.every((k) => typeof k === 'string' && k !== '');
const isScalar = (v: unknown): v is Scalar => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/**
 * Accept untrusted JSON (from a model, a file, a person's edit) as a mapping, or say exactly why not.
 * Nothing that fails here is ever compiled into a transform.
 */
export function validateMapping(raw: unknown, depth = 0): { ok: true; mapping: FieldMapping } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!raw || typeof raw !== 'object') return fail('a mapping must be an object');
  const m = raw as Record<string, unknown>;
  if (!isPath(m.target)) return fail('target must be a non-empty list of keys');
  const s = m.source as Record<string, unknown> | undefined;
  if (!s || typeof s !== 'object' || !SOURCE_OPS.includes(s.op as never)) return fail(`unknown source op ${JSON.stringify(s?.op)}`);
  const transforms = m.transforms ?? [];
  if (!Array.isArray(transforms)) return fail('transforms must be a list');
  switch (s.op) {
    case 'path': if (!isPath(s.path)) return fail('path needs a path'); break;
    case 'coalesce': case 'concat': {
      const ps = s.paths;
      if (!Array.isArray(ps) || ps.length < 2 || ps.length > 3 || !ps.every(isPath)) return fail(`${s.op} takes 2 or 3 paths`);
      if (s.op === 'concat' && typeof s.sep !== 'string') return fail('concat needs a separator');
      break;
    }
    case 'pick': {
      if (!isPath(s.array) || !isPath(s.field)) return fail('pick needs an array and a field');
      const w = s.which as unknown;
      if (w !== 'first' && w !== 'last' && !(w && typeof w === 'object' && isPath((w as { key: unknown }).key) && isScalar((w as { equals: unknown }).equals))) return fail('pick takes first, last or a key and value');
      break;
    }
    case 'values': if (!isPath(s.array) || !Array.isArray(s.field) || !s.field.every((k) => typeof k === 'string')) return fail('values needs an array'); break;
    case 'count': if (!isPath(s.array)) return fail('count needs an array'); break;
    case 'constant': if (!isScalar(s.value)) return fail('constant must be text, a number, true/false or null'); break;
    case 'nested': {
      if (depth > 0) return fail('nested goes one level deep in v1');
      if (!isPath(s.array) || !Array.isArray(s.fields) || s.fields.length === 0) return fail('nested needs an array and child fields');
      for (const c of s.fields) { const r = validateMapping(c, depth + 1); if (!r.ok) return fail(`in ${showPath(isPath(m.target) ? m.target : [])}: ${r.error}`); }
      if (transforms.length) return fail('nested takes no transforms');
      break;
    }
  }
  for (const t of transforms as Record<string, unknown>[]) {
    if (!t || !TRANSFORM_OPS.includes(t.op as never)) return fail(`unknown transform ${JSON.stringify(t?.op)}`);
    if (t.op === 'cast' && !CAST_TO.includes(t.to as never)) return fail('cast goes to string, integer, number or boolean');
    if (t.op === 'parse_date' && (!DATE_FROM.includes(t.from as never) || !['date', 'date-time'].includes(t.out as string))) return fail('parse_date needs a known input and output');
    if (t.op === 'scale' && !(Number.isInteger(t.power) && Math.abs(t.power as number) <= 9 && t.power !== 0)) return fail('scale is a power of ten between -9 and 9');
    if (t.op === 'value_map' && !(t.map && typeof t.map === 'object' && !Array.isArray(t.map) && Object.values(t.map).every(isScalar))) return fail('value_map needs a table of values');
  }
  const mapping = { target: m.target, source: s, transforms } as FieldMapping;
  if (depth === 0 && opCount(mapping) > MAX_OPS && s.op !== 'nested') return fail(`at most ${MAX_OPS} ops per field`);
  if (s.op !== 'nested' && 1 + transforms.length > MAX_OPS) return fail(`at most ${MAX_OPS} ops per field`);
  return { ok: true, mapping };
}
