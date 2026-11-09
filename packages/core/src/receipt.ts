import type { Db } from './db';
import type { Aggregate, AggFn } from './grammar';
import type { TableProfile } from './profile';
import { ident } from './sql/quote';
import { joinParts, withCtes, type Plan } from './joinsql';
import { describeTransforms } from './score';

export interface Pattern { column: string; value: string; unmatchedCount: number; unmatchedTotal: number; overallShare: number; lift: number }
export interface TransformSample { side: 'left' | 'right'; raw: string; transformed: string | null }

export interface Receipt {
  leftRows: number; rightRows: number; joinedRows: number; innerRows: number;
  matchedLeft: number; unmatchedLeft: number; matchedRight: number; unmatchedRight: number;
  matchRateBefore: number | null; matchRateAfter: number;
  fanout: number; maxPerKeyLeft: number; maxPerKeyRight: number; fanoutWarning: boolean;
  patternsLeft: Pattern[]; patternsRight: Pattern[];
  samples: TransformSample[];
  normalisations: string;
  proposedAggregate: Aggregate | null;
  sql: string;
}

export const LIFT_MIN = 3;
export const PATTERN_MIN_COUNT = 3;
export const PATTERN_MIN_DISTINCT = 3;
export const PATTERN_MAX_DISTINCT = 50;
export const FANOUT_WARN = 1.05;

const n = (v: unknown) => Number(v ?? 0);

export async function buildReceipt(db: Db, profiles: TableProfile[], plan: Plan): Promise<Receipt> {
  const p = joinParts(plan, profiles);
  const ctes = [
    ...p.ctes,
    `LK AS (SELECT DISTINCT ${p.lk} AS k FROM L AS l WHERE ${p.lk} IS NOT NULL)`,
    `RK AS (SELECT DISTINCT ${p.rk} AS k FROM R AS r WHERE ${p.rk} IS NOT NULL)`,
  ];
  const q = (body: string) => db.query(withCtes(ctes, body));
  const [c] = await q(`SELECT
    (SELECT count(*) FROM L) AS left_rows,
    (SELECT count(*) FROM R) AS right_rows,
    (SELECT count(*) FROM L AS l WHERE ${p.lk} IN (SELECT k FROM RK)) AS matched_left,
    (SELECT count(*) FROM R AS r WHERE ${p.rk} IN (SELECT k FROM LK)) AS matched_right,
    (SELECT count(*) FROM L AS l JOIN R AS r ON ${p.lk} = ${p.rk}) AS inner_rows,
    (SELECT coalesce(max(m), 0) FROM (SELECT count(*) AS m FROM L AS l WHERE ${p.lk} IS NOT NULL GROUP BY ${p.lk})) AS max_left,
    (SELECT coalesce(max(m), 0) FROM (SELECT count(*) AS m FROM R AS r WHERE ${p.rk} IS NOT NULL GROUP BY ${p.rk})) AS max_right`);
  const leftRows = n(c.left_rows), rightRows = n(c.right_rows), matchedLeft = n(c.matched_left), innerRows = n(c.inner_rows);
  const joinedRows = plan.join.how === 'left' ? innerRows + (leftRows - matchedLeft) : innerRows;
  const fanout = matchedLeft ? innerRows / matchedLeft : 1;
  const maxPerKeyRight = n(c.max_right);

  const transformed = plan.join.left.transforms.length + plan.join.right.transforms.length > 0;
  let matchRateBefore: number | null = null;
  if (transformed) {
    const raw = joinParts({ ...plan, join: { ...plan.join, left: { ...plan.join.left, transforms: [] }, right: { ...plan.join.right, transforms: [] } } }, profiles);
    const [b] = await db.query(withCtes([...raw.ctes, `RK AS (SELECT DISTINCT ${raw.rk} AS k FROM R AS r)`], `SELECT count(*) AS m FROM L AS l WHERE ${raw.lk} IN (SELECT k FROM RK)`));
    matchRateBefore = leftRows ? n(b.m) / leftRows : 0;
  }

  const samples: TransformSample[] = [];
  for (const side of ['left', 'right'] as const) {
    const ref = plan.join[side];
    if (!ref.transforms.length) continue;
    const alias = side === 'left' ? 'l' : 'r', key = side === 'left' ? p.lk : p.rk, src = side === 'left' ? 'L' : 'R';
    const rows = await q(`SELECT raw, k FROM (SELECT DISTINCT CAST(${alias}.${ident(ref.column)} AS VARCHAR) AS raw, ${key} AS k FROM ${src} AS ${alias} WHERE ${alias}.${ident(ref.column)} IS NOT NULL) ORDER BY hash(raw), raw LIMIT 5`);
    for (const r of rows) samples.push({ side, raw: String(r.raw), transformed: r.k == null ? null : String(r.k) });
  }

  const patternsLeft = plan.aggregateLeft ? [] : await patterns(db, ctes, profiles, plan.join.left.table, plan.join.left.column, 'l', 'L', p.lk, 'RK', leftRows - matchedLeft);
  const unmatchedRight = rightRows - n(c.matched_right);
  const patternsRight = plan.aggregateRight ? [] : await patterns(db, ctes, profiles, plan.join.right.table, plan.join.right.column, 'r', 'R', p.rk, 'LK', unmatchedRight);

  const fanoutWarning = fanout > FANOUT_WARN || maxPerKeyRight > 1;
  const rp = profiles.find((x) => x.table === plan.join.right.table);
  const proposedAggregate = fanoutWarning && !plan.aggregateRight && rp ? proposeAggregate(rp, plan.join.right.column) : null;

  return {
    leftRows, rightRows, joinedRows, innerRows,
    matchedLeft, unmatchedLeft: leftRows - matchedLeft, matchedRight: n(c.matched_right), unmatchedRight,
    matchRateBefore, matchRateAfter: leftRows ? matchedLeft / leftRows : 0,
    fanout, maxPerKeyLeft: n(c.max_left), maxPerKeyRight, fanoutWarning,
    patternsLeft, patternsRight, samples,
    normalisations: describeTransforms([...plan.join.left.transforms, ...plan.join.right.transforms]),
    proposedAggregate,
    sql: withCtes(p.ctes, p.select),
  };
}

/** Columns whose values are over-represented among the unmatched rows (lift = unmatched share ÷ overall share). */
async function patterns(
  db: Db, ctes: string[], profiles: TableProfile[], table: string, keyCol: string,
  alias: string, src: string, key: string, otherKeys: string, unmatchedTotal: number,
): Promise<Pattern[]> {
  if (unmatchedTotal < PATTERN_MIN_COUNT) return [];
  const prof = profiles.find((x) => x.table === table);
  if (!prof) return [];
  const cols = prof.columns.filter((c) => c.name !== keyCol && c.distinct >= PATTERN_MIN_DISTINCT && c.distinct <= PATTERN_MAX_DISTINCT);
  const total = prof.rows;
  const found: Pattern[] = [];
  for (const col of cols) {
    const v = `CAST(${alias}.${ident(col.name)} AS VARCHAR)`;
    const rows = await db.query(withCtes(ctes, `SELECT ${v} AS v, count(*) FILTER (WHERE coalesce(${key} IN (SELECT k FROM ${otherKeys}), false) = false) AS u, count(*) AS c FROM ${src} AS ${alias} GROUP BY 1`));
    for (const r of rows) {
      const u = n(r.u), cnt = n(r.c);
      if (u < PATTERN_MIN_COUNT || r.v == null) continue;
      const lift = (u / unmatchedTotal) / (cnt / total);
      if (lift >= LIFT_MIN) found.push({ column: col.name, value: String(r.v), unmatchedCount: u, unmatchedTotal, overallShare: cnt / total, lift });
    }
  }
  found.sort((a, b) => b.lift - a.lift || b.unmatchedCount - a.unmatchedCount || a.column.localeCompare(b.column));
  return found.slice(0, 2);
}

const pct = (x: number) => (x < 0.01 && x > 0 ? '<1%' : `${Math.round(x * 100)}%`);

/** "All 34 unmatched rows have state = AK (AK is 1% of the file)." States the pattern, never a cause. */
export function describePattern(pt: Pattern): string {
  const who = pt.unmatchedCount === pt.unmatchedTotal ? `All ${pt.unmatchedTotal} unmatched rows` : `${pt.unmatchedCount} of ${pt.unmatchedTotal} unmatched rows`;
  return `${who} have ${pt.column} = ${pt.value} (${pt.value} is ${pct(pt.overallShare)} of the file).`;
}

const NUMERIC = /INT|DOUBLE|DECIMAL|FLOAT|REAL/;

/** Roll the many side up to one row per key: sum numbers, keep the first (smallest) value of everything else. */
export function proposeAggregate(profile: TableProfile, keyColumn: string): Aggregate {
  const measures = profile.columns
    .filter((c) => c.name !== keyColumn)
    .map((c) => ({ column: c.name, fn: (NUMERIC.test(c.type) && c.format !== 'integer_id' && c.format !== 'year' ? 'sum' : 'first') as AggFn }));
  return { op: 'aggregate', table: profile.table, by: [keyColumn], measures };
}
