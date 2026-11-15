import { ident } from '../sql/quote';
import { getCategory } from './taxonomy';
import type { ColumnFact } from './check';

export type OptionId = 'generalise' | 'aggregate' | 'suppress_rare' | 'drop' | 'restrict' | 'update_notice' | 'hash';
export const OPTION_IDS: OptionId[] = ['generalise', 'aggregate', 'suppress_rare', 'drop', 'restrict', 'update_notice', 'hash'];
export const RARE_K = 5;

export interface OptionApplication {
  id: OptionId;
  /** Short description of what happens, e.g. "ZIP to its first 3 digits". */
  detail: string;
  /** SQL for the column inside the virtual view; null when the column leaves the data. */
  expr: ((col: string) => string) | null;
  /** The category the column has afterwards; null when it is gone. */
  after: string | null;
  /** True for options that only change the notice or who can see the data. */
  noDataChange?: boolean;
  note?: 'pseudonymises' | 'restricted';
}

const GENERALISE: Record<string, { detail: string; expr: (c: string) => string; after: string }> = {
  'user.contact.address.postal_code': { detail: 'ZIP to its first 3 digits', expr: (c) => `left(CAST(${c} AS VARCHAR), 3)`, after: 'user.location.imprecise' },
  'user.demographic.date_of_birth': { detail: 'date of birth to the year', expr: (c) => `year(TRY_CAST(${c} AS DATE))`, after: 'user.demographic.age_range' },
  'user.location.precise': { detail: 'latitude and longitude to 1 decimal place (about 11 km)', expr: (c) => `round(TRY_CAST(${c} AS DOUBLE), 1)`, after: 'user.location.imprecise' },
  'user.device.ip_address': { detail: 'IPv4 address to its first three parts', expr: (c) => `regexp_replace(CAST(${c} AS VARCHAR), '\\.\\d+$', '.0')`, after: 'user.device.ip_address' },
};

/** Options that make sense for a column of this category, in the order they are offered. */
export function optionsFor(category: string, opts: { notDisclosed?: boolean } = {}): OptionApplication[] {
  const k = getCategory(category);
  const out: OptionApplication[] = [];
  const g = GENERALISE[category];
  if (g) out.push({ id: 'generalise', detail: g.detail, expr: g.expr, after: g.after });
  out.push({ id: 'aggregate', detail: 'keep counts by group instead of one row per person', expr: null, after: null });
  if (k.kind !== 'other') out.push({ id: 'suppress_rare', detail: `blank out values that fewer than ${RARE_K} rows share`, expr: (c) => `CASE WHEN count(*) OVER (PARTITION BY ${c}) < ${RARE_K} THEN NULL ELSE ${c} END`, after: category });
  out.push({ id: 'drop', detail: 'remove the column', expr: null, after: null });
  out.push({ id: 'restrict', detail: 'limit who can read it', expr: null, after: category, noDataChange: true, note: 'restricted' });
  if (opts.notDisclosed !== false) out.push({ id: 'update_notice', detail: 'name it in the notice', expr: null, after: category, noDataChange: true });
  if (k.kind === 'direct') out.push({ id: 'hash', detail: 'replace with a one-way hash', expr: (c) => `md5(CAST(${c} AS VARCHAR))`, after: category, note: 'pseudonymises' });
  return out;
}

export type Choices = Record<string, OptionId>; // key: `${table}.${column}`
export const choiceKey = (table: string, column: string) => `${table}.${column}`;

export function applicationFor(fact: ColumnFact, id: OptionId): OptionApplication | undefined {
  return optionsFor(fact.category).find((o) => o.id === id);
}

/** The facts after the chosen options: dropped columns vanish, generalised ones change category. Nothing is written. */
export function applyToFacts(facts: ColumnFact[], choices: Choices): ColumnFact[] {
  const out: ColumnFact[] = [];
  for (const f of facts) {
    const id = choices[choiceKey(f.table, f.column)];
    const app = id ? applicationFor(f, id) : undefined;
    if (!app) { out.push(f); continue; }
    if (app.after === null) continue;
    out.push({ ...f, category: app.after });
  }
  return out;
}

/** Categories the person decided to name in the notice. */
export function plannedNoticeCategories(facts: ColumnFact[], choices: Choices): string[] {
  return facts.filter((f) => choices[choiceKey(f.table, f.column)] === 'update_notice').map((f) => f.category);
}

/** A SELECT that shows a table as if the chosen options were applied. The original table is untouched. */
export function virtualSelect(table: string, columns: { name: string; category?: string; confidence?: number }[], facts: ColumnFact[], choices: Choices): string {
  const parts: string[] = [];
  for (const c of columns) {
    const fact = facts.find((f) => f.table === table && f.column === c.name);
    const id = choices[choiceKey(table, c.name)];
    const app = fact && id ? applicationFor(fact, id) : undefined;
    const q = ident(c.name);
    if (app && app.after === null) continue;
    parts.push(app?.expr ? `${app.expr(q)} AS ${q}` : q);
  }
  return `SELECT ${parts.length ? parts.join(', ') : '1 AS _empty'} FROM ${ident(table)}`;
}
