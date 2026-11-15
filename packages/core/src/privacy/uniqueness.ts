import type { Db } from '../db';
import { ident } from '../sql/quote';

export interface UniquenessResult {
  qi: string[];
  /** Entities (or rows, when there is no entity column) counted. */
  total: number;
  /** Entities none of whose QI values are shared with another entity. */
  unique: number;
  share: number;
}
export interface RiskySubset { columns: string[]; unique: number; share: number }

const NULL_MARK = '\u0001NULL';

/** One tuple key per row: NULLs count as a value, so two empty cells match. */
const keyExpr = (qi: string[]) => `concat_ws(chr(31), ${qi.map((c) => `coalesce(CAST(${ident(c)} AS VARCHAR), '${NULL_MARK}')`).join(', ')})`;

/**
 * How many entities are unique on these columns. `relation` is a table or view name. With an entity column, the entity
 * is unique when none of its QI tuples appears for any other entity. Without one, each row is an entity.
 */
export async function measureUniqueness(db: Db, relation: string, qi: string[], entity?: string): Promise<UniquenessResult> {
  if (!qi.length) return { qi, total: 0, unique: 0, share: 0 };
  const ent = entity ? `CAST(${ident(entity)} AS VARCHAR)` : 'CAST(row_number() OVER () AS VARCHAR)';
  const sql = `
    WITH e AS (SELECT DISTINCT ${ent} AS ent, ${keyExpr(qi)} AS k FROM ${ident(relation)}),
    t AS (SELECT k, count(*) AS n FROM e GROUP BY k),
    shared AS (SELECT DISTINCT e.ent FROM e JOIN t ON e.k = t.k WHERE t.n > 1)
    SELECT (SELECT count(DISTINCT ent) FROM e) AS total, (SELECT count(DISTINCT ent) FROM e WHERE ent NOT IN (SELECT ent FROM shared)) AS uniq`;
  const [r] = await db.query(sql);
  const total = Number(r.total), unique = Number(r.uniq);
  return { qi, total, unique, share: total ? unique / total : 0 };
}

/** The smallest column sets (up to `maxSize`) that make at least `threshold` of the entities unique. */
export async function findRiskySubsets(db: Db, relation: string, qi: string[], entity: string | undefined, threshold = 0.5, maxSize = 3): Promise<RiskySubset[]> {
  const cols = qi.slice(0, 12);
  const found: RiskySubset[] = [];
  const covered = (s: string[]) => found.some((f) => f.columns.every((c) => s.includes(c)));
  const combos = (k: number): string[][] => {
    const out: string[][] = [];
    const rec = (start: number, cur: string[]) => {
      if (cur.length === k) { out.push([...cur]); return; }
      for (let i = start; i < cols.length; i++) rec(i + 1, [...cur, cols[i]]);
    };
    rec(0, []);
    return out;
  };
  for (let k = 1; k <= Math.min(maxSize, cols.length); k++) {
    for (const s of combos(k)) {
      if (covered(s)) continue;
      const r = await measureUniqueness(db, relation, s, entity);
      if (r.share >= threshold) found.push({ columns: s, unique: r.unique, share: r.share });
    }
  }
  return found.sort((a, b) => a.columns.length - b.columns.length || b.share - a.share || a.columns.join().localeCompare(b.columns.join()));
}

/** Create or replace a view the checks can read. The user's file is never touched. */
export async function createView(db: Db, name: string, selectSql: string): Promise<void> {
  await db.query(`CREATE OR REPLACE VIEW ${ident(name)} AS ${selectSql}`);
}
