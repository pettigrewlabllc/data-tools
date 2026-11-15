import {
  getCategory, ident, virtualSelect, applicationFor, finishPolicy,
  type Classification, type ColumnFact, type Choices, type Policy, type TableProfile,
} from '@data-tools/core';

export interface ColState { name: string; type: string; proposal: Classification }
export interface TableState {
  name: string; file: string; source: 'file' | 'ddl'; rows?: number; profile?: TableProfile; columns: ColState[];
}
/** The category a person set for a column; null means "not personal information". */
export type Overrides = Record<string, string | null>;
export type Confirmed = Record<string, true>;
export const colKey = (table: string, column: string) => `${table}.${column}`;

export function finalCategory(t: TableState, c: ColState, o: Overrides): string | null {
  const k = colKey(t.name, c.name);
  return k in o ? o[k] : c.proposal.category;
}

export function factsFor(tables: TableState[], o: Overrides, confirmed: Confirmed): ColumnFact[] {
  const out: ColumnFact[] = [];
  for (const t of tables) for (const c of t.columns) {
    const category = finalCategory(t, c, o);
    if (!category) continue;
    const k = colKey(t.name, c.name);
    const changed = k in o;
    out.push({ table: t.name, column: c.name, type: c.type, category, confidence: changed ? 1 : c.proposal.confidence, confirmed: changed || !!confirmed[k] });
  }
  return out;
}

/** The policy plus any categories the person chose to add to the notice. Nothing is saved to the confirmed policy. */
export function withPlanned(p: Policy, categories: string[]): Policy {
  const have = new Set(p.categories.filter((l) => l.status !== 'not_collected').map((l) => l.category));
  const add = categories.filter((c) => !have.has(c)).map((category) => ({ category, status: 'disclosed' as const, source: 'ticked' as const }));
  const kept = p.categories.filter((l) => !add.some((a) => a.category === l.category));
  return finishPolicy({ ...p, categories: [...kept, ...add] });
}

export interface Link { base: string; other: string }

/** One SELECT over the chosen tables, each with its options applied, columns named table__column. `facts` are the ones before any option. */
export function combinedSelect(
  selected: TableState[], links: Record<string, Link>, facts: ColumnFact[], choices: Choices,
): { sql: string; columns: { table: string; column: string; alias: string }[] } {
  const parts: string[] = [];
  const columns: { table: string; column: string; alias: string }[] = [];
  const from: string[] = [];
  for (const t of selected) {
    const a = ident('v_' + t.name);
    from.push(`(${virtualSelect(t.name, t.columns.map((c) => ({ name: c.name })), facts, choices)}) AS ${a}`);
    for (const c of t.columns) {
      const fact = facts.find((f) => f.table === t.name && f.column === c.name);
      const id = choices[colKey(t.name, c.name)];
      const app = fact && id ? applicationFor(fact, id) : undefined;
      if (app && app.after === null) continue;
      const alias = `${t.name}__${c.name}`;
      columns.push({ table: t.name, column: c.name, alias });
      parts.push(`${a}.${ident(c.name)} AS ${ident(alias)}`);
    }
  }
  let sql = `SELECT ${parts.join(', ')} FROM ${from[0]}`;
  for (let i = 1; i < selected.length; i++) {
    const l = links[selected[i].name];
    sql += ` LEFT JOIN ${from[i]} ON CAST(${ident('v_' + selected[0].name)}.${ident(l.base)} AS VARCHAR) = CAST(${ident('v_' + selected[i].name)}.${ident(l.other)} AS VARCHAR)`;
  }
  return { sql, columns };
}

export const kindOf = (category: string) => getCategory(category).kind;
