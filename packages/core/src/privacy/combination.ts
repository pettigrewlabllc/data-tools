import type { Db } from '../db';
import type { TableProfile } from '../profile';
import { candidatesForPair } from '../candidates';
import { evaluateRules, type RuleHit } from './rules';
import { getCategory } from './taxonomy';

export interface TableCategories { table: string; categories: string[] }

export interface CombinationResult {
  /** Every category the tables bring together. */
  union: string[];
  perTable: { table: string; categories: string[]; hits: RuleHit[] }[];
  hits: RuleHit[];
  /** Rules that fire on the union and on no single table. */
  combinationOnly: RuleHit[];
}

/** What a set of tables brings together, and which rules fire only because they are put together. No data needed. */
export function checkCombination(tables: TableCategories[]): CombinationResult {
  const union = [...new Set(tables.flatMap((t) => t.categories))].sort();
  const perTable = tables.map((t) => ({ table: t.table, categories: [...new Set(t.categories)].sort(), hits: evaluateRules(t.categories) }));
  const hits = evaluateRules(union);
  const single = new Set(perTable.flatMap((t) => t.hits.map((h) => h.rule.id)));
  return { union, perTable, hits, combinationOnly: hits.filter((h) => !single.has(h.rule.id)) };
}

/** Suggest the key that links two loaded tables, using the shared candidate finder. */
export async function suggestLink(db: Db, a: TableProfile, b: TableProfile): Promise<{ left: string; right: string } | null> {
  const r = await candidatesForPair(db, a, b);
  const top = r.best[0];
  return r.reliable && top ? { left: top.left.column, right: top.right.column } : null;
}

export const isDirect = (cat: string) => getCategory(cat).kind === 'direct';
