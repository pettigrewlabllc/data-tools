import { sideRefs, type Aggregate, type JoinOn, type KeyRef } from './grammar';
import type { TableProfile } from './profile';
import { ident } from './sql/quote';
import { crosswalkCtes, compositeKeyExpr } from './sql/emit';

export interface Plan { join: JoinOn; aggregateLeft?: Aggregate | null; aggregateRight?: Aggregate | null }

/** How a table is read: the bare table name in the app, a file reader in an exported script. */
export type SourceFn = (table: string) => string;
export const tableSource: SourceFn = (t) => `SELECT * FROM ${ident(t)}`;

function aggSql(a: Aggregate, from: string): string {
  const fn = (f: string, c: string) => (f === 'first' ? `min(${c})` : f === 'count' ? `count(${c})` : `${f}(${c})`);
  const cols = [...a.by.map(ident), ...a.measures.map((m) => `${fn(m.fn, ident(m.column))} AS ${ident(m.column)}`)];
  return `SELECT ${cols.join(', ')} FROM (${from}) AS src GROUP BY ${a.by.map(ident).join(', ')}`;
}

export function sideColumns(table: string, agg: Aggregate | null | undefined, profiles: TableProfile[]): string[] {
  if (agg) return [...agg.by, ...agg.measures.map((m) => m.column)];
  return profiles.find((p) => p.table === table)?.columns.map((c) => c.name) ?? [];
}

/** Key refs pointed at the L/R aliases used by every join query. */
export const onAlias = (k: KeyRef): KeyRef => k;

export interface JoinParts {
  ctes: string[];      // crosswalks, L, R
  lk: string;          // left key expression over alias l
  rk: string;          // right key expression over alias r
  select: string;      // the joined SELECT (uses L, R)
  leftCols: string[];
  rightCols: { name: string; as: string }[];
}

/** The one place the join's SQL is built. Receipts and exported scripts both use it. */
export function joinParts(plan: Plan, profiles: TableProfile[], source: SourceFn = tableSource): JoinParts {
  const { left, right, how } = plan.join;
  const lrefs = sideRefs(plan.join, 'left'), rrefs = sideRefs(plan.join, 'right');
  const lsrc = source(left.table), rsrc = source(right.table);
  const ctes = [
    ...crosswalkCtes([...lrefs, ...rrefs]),
    `L AS (${plan.aggregateLeft ? aggSql(plan.aggregateLeft, lsrc) : lsrc})`,
    `R AS (${plan.aggregateRight ? aggSql(plan.aggregateRight, rsrc) : rsrc})`,
  ];
  const lk = compositeKeyExpr(lrefs, 'l'), rk = compositeKeyExpr(rrefs, 'r');
  const leftCols = sideColumns(left.table, plan.aggregateLeft, profiles);
  const taken = new Set(leftCols);
  const rightCols = sideColumns(right.table, plan.aggregateRight, profiles).map((name) => {
    let as = name;
    if (taken.has(as)) as = `${right.table}_${name}`;
    for (let i = 2; taken.has(as); i++) as = `${right.table}_${name}_${i}`;
    taken.add(as);
    return { name, as };
  });
  const cols = [
    ...leftCols.map((c) => `l.${ident(c)}`),
    ...rightCols.map((c) => (c.name === c.as ? `r.${ident(c.name)}` : `r.${ident(c.name)} AS ${ident(c.as)}`)),
  ];
  const select = `SELECT ${cols.join(', ')}\nFROM L AS l\n${how === 'left' ? 'LEFT JOIN' : 'INNER JOIN'} R AS r ON ${lk} = ${rk}`;
  return { ctes, lk, rk, select, leftCols, rightCols };
}

export function withCtes(ctes: string[], body: string): string {
  return `WITH ${ctes.join(',\n')}\n${body}`;
}
