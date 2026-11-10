import type { KeyRef, Transform, CrosswalkTable, CodeKind } from '../grammar';
import { CROSSWALKS } from './crosswalks';
import { ident, lit } from './quote';

const V = (x: string) => `CAST(${x} AS VARCHAR)`;

export function cwName(table: CrosswalkTable): string {
  return `cw_${table}`;
}

/** Normalise a raw value before looking it up in a crosswalk: FIPS codes are compared padded to 2 digits. */
function lookupKey(x: string, from: CodeKind): string {
  return from === 'fips' ? `lpad(trim(${V(x)}), 2, '0')` : `upper(trim(${V(x)}))`;
}

export function transformSql(x: string, t: Transform): string {
  switch (t.op) {
    case 'trim':
      return `trim(${V(x)})`;
    case 'lower':
      return `lower(${V(x)})`;
    case 'upper':
      return `upper(${V(x)})`;
    case 'lpad':
      return `lpad(${V(x)}, ${lit(t.width)}, ${lit(t.fill)})`;
    case 'cast':
      return t.to === 'varchar' ? V(x) : t.to === 'integer' ? `TRY_CAST(${x} AS BIGINT)` : `TRY_CAST(${x} AS DATE)`;
    case 'date_trunc':
      return `CAST(date_trunc(${lit(t.unit)}, TRY_CAST(${x} AS TIMESTAMP)) AS DATE)`;
    case 'crosswalk': {
      const cw = cwName(t.table);
      const fromCol = t.from === 'fips' ? 'fips' : `upper(${ident(t.from)})`;
      return `(SELECT ${ident(t.to)} FROM ${cw} WHERE ${fromCol} = ${lookupKey(x, t.from)} LIMIT 1)`;
    }
  }
}

/** The SQL expression for a join key: transforms applied left to right, compared as text. */
export function keyExpr(ref: KeyRef, alias: string): string {
  let x = `${ident(alias)}.${ident(ref.column)}`;
  for (const t of ref.transforms) x = transformSql(x, t);
  return V(x);
}

/** CTE definitions for every crosswalk the keys use, in a fixed order. */
export function crosswalkCtes(refs: KeyRef[]): string[] {
  const used = new Set<CrosswalkTable>();
  for (const r of refs) for (const t of r.transforms) if (t.op === 'crosswalk') used.add(t.table);
  return [...used].sort().map((table) => {
    const { rows, kinds } = CROSSWALKS[table];
    const values = rows.map((r) => `(${kinds.map((k) => lit(r[k] ?? '')).join(', ')})`).join(',\n    ');
    return `${cwName(table)}(${kinds.map(ident).join(', ')}) AS (\n  VALUES\n    ${values}\n)`;
  });
}

export function withClause(ctes: string[]): string {
  return ctes.length ? `WITH ${ctes.join(',\n')}\n` : '';
}
