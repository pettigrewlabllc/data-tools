/**
 * The shape you need, from one of three inputs: a JSON Schema (2020-12 or draft-07, local `$ref` only), an
 * example record (a schema is inferred and shown for confirmation), or a list of column names.
 */
import type { Path, Scalar } from './grammar';
import type { Json } from './json';
import { parseJson } from './json';

export type TargetKind = 'schema' | 'example' | 'columns';
export type TargetType = 'string' | 'integer' | 'number' | 'boolean';

export interface TargetField {
  id: string;
  context: Path | null;
  path: Path;
  kind: 'scalar' | 'scalar_array' | 'object_array';
  type?: TargetType;
  itemType?: TargetType;
  nullable: boolean;
  required: boolean;
  format?: string;
  enum?: Scalar[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  description?: string;
}

export interface Target {
  kind: TargetKind;
  /** The JSON Schema output records are validated against; absent for a column list. */
  schema?: Record<string, unknown>;
  draft: '2020-12' | '07' | null;
  fields: TargetField[];
}

type S = Record<string, unknown>;

const isObj = (v: unknown): v is S => !!v && typeof v === 'object' && !Array.isArray(v);

function resolveRef(root: S, ref: string): S {
  if (!ref.startsWith('#')) throw new Error(`the schema refers to "${ref}", which is outside this file; only local $ref (starting with #) is read, and nothing is fetched`);
  let cur: unknown = root;
  for (const part of ref.replace(/^#\/?/, '').split('/').filter(Boolean)) {
    const k = decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'));
    cur = isObj(cur) ? cur[k] : undefined;
  }
  if (!isObj(cur)) throw new Error(`the schema refers to "${ref}", which isn't in the file`);
  return cur;
}

/** Inline refs and merge allOf, so each node can be read directly. `seen` stops reference cycles. */
function norm(root: S, s: S, seen: string[] = []): S {
  let n = s;
  if (typeof n.$ref === 'string') {
    if (seen.includes(n.$ref)) return {};
    const { $ref, ...rest } = n;
    n = { ...norm(root, resolveRef(root, $ref as string), [...seen, $ref as string]), ...rest };
  }
  if (Array.isArray(n.allOf)) {
    const { allOf, ...rest } = n;
    const parts = (allOf as S[]).map((p) => norm(root, p, seen));
    n = parts.reduce<S>((acc, p) => ({ ...acc, ...p, properties: { ...(acc.properties as S), ...(p.properties as S) }, required: [...((acc.required as string[]) ?? []), ...((p.required as string[]) ?? [])] }), rest);
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    if (Array.isArray(n[key])) {
      const opts = (n[key] as S[]).map((p) => norm(root, p, seen));
      const nonNull = opts.filter((o) => o.type !== 'null');
      if (nonNull.length === 1) { const { [key]: _, ...rest } = n; n = { ...nonNull[0], ...rest, nullable: nonNull.length < opts.length }; }
    }
  }
  return n;
}

function readType(n: S): { type?: TargetType | 'object' | 'array'; nullable: boolean } {
  const t = n.type;
  const list = Array.isArray(t) ? (t as string[]) : typeof t === 'string' ? [t] : [];
  const nonNull = list.filter((x) => x !== 'null');
  const nullable = list.includes('null') || n.nullable === true || (Array.isArray(n.enum) && n.enum.includes(null));
  let type = nonNull[0] as TargetType | 'object' | 'array' | undefined;
  if (!type && isObj(n.properties)) type = 'object';
  if (!type && n.items) type = 'array';
  if (!type && Array.isArray(n.enum)) {
    const e = (n.enum as unknown[]).filter((x) => x !== null);
    type = e.every((x) => typeof x === 'string') ? 'string' : e.every((x) => Number.isInteger(x)) ? 'integer' : e.every((x) => typeof x === 'number') ? 'number' : undefined;
  }
  return { type, nullable };
}

const rules = (n: S): Partial<TargetField> => {
  const out: Partial<TargetField> = {};
  if (typeof n.format === 'string') out.format = n.format;
  if (Array.isArray(n.enum)) out.enum = (n.enum as Scalar[]).filter((x) => x !== null);
  if (n.const !== undefined) out.enum = [n.const as Scalar];
  for (const k of ['pattern', 'description'] as const) if (typeof n[k] === 'string') out[k] = n[k] as string;
  for (const k of ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength'] as const) if (typeof n[k] === 'number') out[k] = n[k] as number;
  return out;
};

function flatten(root: S, node: S, context: Path | null, path: Path, required: boolean, out: TargetField[], depth: number) {
  const n = norm(root, node);
  const { type, nullable } = readType(n);
  const id = (context ? `${context.join('.')}[]` + (path.length ? '.' : '') : '') + path.join('.');
  if (type === 'object' || (!type && isObj(n.properties))) {
    const req = new Set((n.required as string[]) ?? []);
    for (const [k, child] of Object.entries((n.properties as S) ?? {})) flatten(root, child as S, context, [...path, k], req.has(k), out, depth + 1);
    return;
  }
  if (type === 'array') {
    const items = isObj(n.items) ? norm(root, n.items as S) : {};
    const it = readType(items);
    if (it.type === 'object' && context === null) {
      out.push({ id: `${id}[]`, context, path, kind: 'object_array', nullable, required, ...rules(n) });
      const req = new Set((items.required as string[]) ?? []);
      for (const [k, child] of Object.entries((items.properties as S) ?? {})) flatten(root, child as S, path, [k], req.has(k), out, depth + 1);
      return;
    }
    if (it.type === 'object') throw new Error(`"${id}" is an array inside an array; v1 maps one level of nesting`);
    out.push({ id: `${id}[]`, context, path, kind: 'scalar_array', itemType: it.type as TargetType | undefined, nullable, required, ...rules(items) });
    return;
  }
  out.push({ id, context, path, kind: 'scalar', type: type as TargetType | undefined, nullable, required, ...rules(n) });
}

export function targetFromSchema(text: string): Target {
  let schema: unknown;
  try { schema = JSON.parse(text); } catch (e) { throw new Error(`the schema isn't JSON: ${(e as Error).message}`); }
  if (!isObj(schema)) throw new Error('a JSON Schema is an object');
  const findRemote = (v: unknown): string | null => {
    if (Array.isArray(v)) { for (const x of v) { const r = findRemote(x); if (r) return r; } return null; }
    if (!isObj(v)) return null;
    if (typeof v.$ref === 'string' && !v.$ref.startsWith('#')) return v.$ref;
    for (const x of Object.values(v)) { const r = findRemote(x); if (r) return r; }
    return null;
  };
  const remote = findRemote(schema);
  if (remote) throw new Error(`the schema refers to "${remote}", which is outside this file; only local $ref (starting with #) is read, and nothing is fetched`);
  const $schema = String(schema.$schema ?? '');
  const draft = /draft-07|draft-06|draft-04/.test($schema) ? '07' : '2020-12';
  const fields: TargetField[] = [];
  flatten(schema, schema, null, [], true, fields, 0);
  if (fields.length === 0) throw new Error('the schema has no properties to map');
  return { kind: 'schema', schema, draft, fields };
}

export interface Loosen { intAsNumber?: boolean; nullable?: boolean; optional?: boolean }

/** A schema inferred from one example record. Shown for confirmation, with one-click loosening. */
export function inferSchema(example: Json, loosen: Loosen = {}): Record<string, unknown> {
  const node = (v: Json): S => {
    const nul = (s: S): S => (loosen.nullable && s.type && s.type !== 'object' ? { ...s, type: [s.type as string, 'null'] } : s);
    if (v === null) return {};
    if (Array.isArray(v)) return { type: 'array', items: v.length ? node(v[0]) : {} };
    if (typeof v === 'object') {
      const props: S = {};
      for (const [k, x] of Object.entries(v)) props[k] = node(x);
      return { type: 'object', properties: props, ...(loosen.optional ? {} : { required: Object.keys(v).filter((k) => v[k] !== null) }) };
    }
    if (typeof v === 'number') return nul({ type: Number.isInteger(v) && !loosen.intAsNumber ? 'integer' : 'number' });
    if (typeof v === 'boolean') return nul({ type: 'boolean' });
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return nul({ type: 'string', format: 'date' });
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return nul({ type: 'string', format: 'date-time' });
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return nul({ type: 'string', format: 'email' });
    if (/^https?:\/\//.test(v)) return nul({ type: 'string', format: 'uri' });
    return nul({ type: 'string' });
  };
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...node(example) };
}

export function targetFromExample(text: string, loosen: Loosen = {}): Target {
  const { value } = parseJson(text.trim());
  const ex = Array.isArray(value) ? value[0] : value;
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) throw new Error('an example record is a JSON object');
  const schema = inferSchema(ex, loosen);
  const t = targetFromSchema(JSON.stringify(schema));
  return { ...t, kind: 'example' };
}

/** Column names, one per line or comma-separated. Dots nest (`customer.email`); `items[].sku` is a line item. */
export function targetFromColumns(text: string): Target {
  const names = text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) throw new Error('no column names');
  const fields: TargetField[] = [];
  const arrays = new Set<string>();
  for (const n of names) {
    const m = /^(.+?)\[\]\.(.+)$/.exec(n);
    if (m) {
      const ctx = m[1].split('.');
      if (!arrays.has(m[1])) { arrays.add(m[1]); fields.push({ id: `${m[1]}[]`, context: null, path: ctx, kind: 'object_array', nullable: true, required: false }); }
      fields.push({ id: n, context: ctx, path: m[2].split('.'), kind: 'scalar', nullable: true, required: false });
    } else if (n.endsWith('[]')) {
      fields.push({ id: n, context: null, path: n.slice(0, -2).split('.'), kind: 'scalar_array', nullable: true, required: false });
    } else fields.push({ id: n, context: null, path: n.split('.'), kind: 'scalar', nullable: true, required: false });
  }
  return { kind: 'columns', draft: null, fields };
}
