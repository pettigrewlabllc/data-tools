/**
 * The JSON path profiler. Core's `profileTable` is SQL over a flat table and can't see inside a payload; this
 * walks every record and describes every path in it. Arrays of objects open a context (an order's `items[]`);
 * paths inside are profiled per item and relative to it, one level deep in v1.
 */
import { classifyValues, type EpochUnit, type FormatClass } from './formats';
import type { Json } from './json';
import type { Path, Scalar } from './grammar';

export type ValueType = 'string' | 'integer' | 'number' | 'boolean' | 'null' | 'object' | 'array';
export type PathKind = 'scalar' | 'scalar_array' | 'object_array' | 'object';

export interface PathProfile {
  /** Display id: `customer.email`, `items[].sku`, `tags[]`. */
  id: string;
  /** The array this path sits inside (an object array at the record level), or null for the record itself. */
  context: Path | null;
  /** Keys from the context to the value. */
  path: Path;
  kind: PathKind;
  /** Records (or items, inside a context) the path was looked for in. */
  total: number;
  present: number;
  nulls: number;
  missing: number;
  types: Partial<Record<ValueType, number>>;
  distinct: number;
  /** Up to 200 non-null values, in order, for scoring and rule checks. Scalar arrays contribute their items. */
  values: Scalar[];
  format: FormatClass;
  epoch?: EpochUnit;
  allInt: boolean;
  min?: number;
  max?: number;
  maxLen: number;
  bigInt: boolean;
  /** For object arrays: how many items they hold across all records. For scalar arrays too. */
  items?: number;
}

export interface SourceProfile { records: number; paths: PathProfile[]; thin: boolean }

const VALUE_CAP = 200;

const typeOf = (v: Json): ValueType =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : (typeof v as ValueType);

interface Acc { context: Path | null; path: Path; total: number; present: number; nulls: number; types: Partial<Record<ValueType, number>>; values: Scalar[]; seen: Set<string>; items: number; kinds: Set<PathKind> }

export const pathId = (context: Path | null, path: Path) =>
  (context ? `${context.join('.')}[]` + (path.length ? '.' : '') : '') + path.join('.');

export function profileRecords(records: Json[], bigIntPaths: string[] = []): SourceProfile {
  const accs = new Map<string, Acc>();
  const big = new Set(bigIntPaths);
  const get = (context: Path | null, path: Path): Acc => {
    const id = pathId(context, path);
    let a = accs.get(id);
    if (!a) { a = { context, path, total: 0, present: 0, nulls: 0, types: {}, values: [], seen: new Set(), items: 0, kinds: new Set() }; accs.set(id, a); }
    return a;
  };
  const addValue = (a: Acc, v: Scalar) => {
    const key = typeof v + ':' + String(v);
    a.seen.add(key);
    if (a.values.length < VALUE_CAP) a.values.push(v);
  };

  // Each "unit" is a record, or an item inside a record-level object array. Paths are collected per unit, then
  // each known path in that context is counted as present or missing.
  const units = new Map<string, Json[]>();
  const pushUnit = (ctx: string, v: Json) => { const l = units.get(ctx) ?? []; l.push(v); units.set(ctx, l); };

  const walk = (v: Json, context: Path | null, path: Path, depth: number) => {
    if (path.length === 0) return walkObj(v as Record<string, Json>, context, path, depth);
    const a = get(context, path);
    const t = typeOf(v);
    a.types[t] = (a.types[t] ?? 0) + 1;
    if (v === null) { a.nulls++; return; }
    a.present++;
    if (Array.isArray(v)) {
      const objs = v.length > 0 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x));
      a.kinds.add(objs ? 'object_array' : 'scalar_array');
      a.items += v.length;
      if (objs) {
        // One level deep in v1: an array of objects inside an item is described, not opened.
        if (context === null) for (const it of v) pushUnit(JSON.stringify(path), it);
      } else for (const x of v) if (x === null || typeof x !== 'object') addValue(a, x as Scalar);
      return;
    }
    if (typeof v === 'object') { a.kinds.add('object'); return walkObj(v, context, path, depth); }
    a.kinds.add('scalar');
    addValue(a, v as Scalar);
  };
  const walkObj = (o: Record<string, Json>, context: Path | null, path: Path, depth: number) => {
    if (depth > 12) return;
    for (const [k, x] of Object.entries(o)) walk(x, context, [...path, k], depth + 1);
  };

  for (const r of records) walk(r, null, [], 0);
  for (const [ctx, items] of units) {
    const context = JSON.parse(ctx) as Path;
    for (const it of items) walk(it, context, [], 0);
  }

  // Presence: count each path against the units of its context. Leaf paths only exist where seen, so totals
  // come from the number of units (records, or items in that array).
  const unitCount = (context: Path | null) => (context ? units.get(JSON.stringify(context))?.length ?? 0 : records.length);
  const paths: PathProfile[] = [];
  for (const [id, a] of accs) {
    // A parent object is a container, not a source; its leaves are profiled.
    const kinds = [...a.kinds];
    const kind: PathKind = kinds.includes('object_array') ? 'object_array' : kinds.includes('scalar_array') ? 'scalar_array' : kinds.includes('scalar') ? 'scalar' : kinds.includes('object') ? 'object' : 'scalar';
    const total = unitCount(a.context);
    const nums = a.values.filter((v): v is number => typeof v === 'number');
    const name = a.path[a.path.length - 1] ?? '';
    const { format, epoch } = kind === 'object' || kind === 'object_array' ? { format: 'unknown' as FormatClass, epoch: undefined } : classifyValues({ name, values: a.values, distinct: a.seen.size });
    paths.push({
      id: kind === 'scalar_array' ? `${id}[]` : kind === 'object_array' ? `${id}[]` : id,
      context: a.context, path: a.path, kind, total,
      present: a.present, nulls: a.nulls, missing: Math.max(0, total - a.present - a.nulls),
      types: a.types, distinct: a.seen.size, values: a.values, format, epoch,
      allInt: a.values.length > 0 && a.values.every((v) => (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && /^-?\d+$/.test(v))),
      min: nums.length ? Math.min(...nums) : undefined, max: nums.length ? Math.max(...nums) : undefined,
      maxLen: a.values.reduce<number>((m, v) => Math.max(m, String(v).length), 0),
      bigInt: big.has(id) || big.has(`${id}[]`),
      items: kind === 'object_array' || kind === 'scalar_array' ? a.items : undefined,
    });
  }
  paths.sort((x, y) => x.id.localeCompare(y.id));
  const distinctRecords = new Set(records.map((r) => JSON.stringify(r))).size;
  return { records: records.length, paths, thin: distinctRecords < 3 };
}

/** "2 of 3" below 10, a percentage from 10 up. */
export function share(n: number, of: number): string {
  if (of < 10) return `${n} of ${of}`;
  return `${Math.round((100 * n) / of)}%`;
}
