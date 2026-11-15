import { ancestors, crosswalk, getCategory, isCategory } from './taxonomy';
import type { Policy, PolicyLine } from './policy';
import { M, labelOf } from './messages';

export type FindingClass = 'disclosed' | 'vague' | 'not_disclosed' | 'contradicted';
export type Why = 'exact' | 'hedged' | 'parent' | 'child' | 'umbrella' | 'not_collected' | 'parent_not_collected' | 'weaker_variant' | 'none';

/** A column with the category a person confirmed (or the classifier proposed). */
export interface ColumnFact {
  table: string; column: string; type?: string;
  category: string; confidence: number;
  /** A person confirmed or changed the category. Unconfirmed low-confidence columns give provisional findings. */
  confirmed: boolean;
}

export interface Finding {
  table: string; column: string; category: string;
  cls: FindingClass; why: Why;
  /** True when the column's category is a low-confidence guess nobody has confirmed. */
  provisional: boolean;
  line?: PolicyLine;
  text: string;
  citations: ReturnType<typeof crosswalk>;
}

const MIN_CONFIDENT = 0.75;

function lineFor(policy: Policy, cat: string): PolicyLine | undefined {
  return policy.categories.find((l) => l.category === cat);
}

export function classifyFinding(category: string, policy: Policy): { cls: FindingClass; why: Why; line?: PolicyLine } {
  const exact = lineFor(policy, category);
  if (exact) {
    if (exact.status === 'not_collected') return { cls: 'contradicted', why: 'not_collected', line: exact };
    if (exact.status === 'vague') return { cls: 'vague', why: 'hedged', line: exact };
    return { cls: 'disclosed', why: 'exact', line: exact };
  }
  const ups = ancestors(category);
  for (const a of ups.filter((x) => x !== 'user')) {
    const l = lineFor(policy, a);
    if (!l) continue;
    return l.status === 'not_collected' ? { cls: 'contradicted', why: 'parent_not_collected', line: l } : { cls: 'vague', why: 'parent', line: l };
  }
  const weaker = (getCategory(category).weakerVariants ?? []).map((w) => lineFor(policy, w)).find((l) => l && l.status !== 'not_collected');
  if (weaker) return { cls: 'contradicted', why: 'weaker_variant', line: weaker };
  const root = lineFor(policy, 'user');
  if (root) return root.status === 'not_collected' ? { cls: 'contradicted', why: 'parent_not_collected', line: root } : { cls: 'vague', why: 'umbrella', line: root };
  const child = policy.categories.find((l) => l.category.startsWith(category + '.') && l.status !== 'not_collected');
  if (child) return { cls: 'vague', why: 'child', line: child };
  return { cls: 'not_disclosed', why: 'none' };
}

export function describe(category: string, c: { cls: FindingClass; why: Why; line?: PolicyLine }): string {
  const label = labelOf(category);
  const l = c.line;
  const quote = l?.quote ?? '';
  let body: string;
  switch (c.why) {
    case 'exact': body = quote ? M.disclosed(label, quote) : M.discloseSource(label, l?.source ?? 'policy'); break;
    case 'hedged': body = quote ? M.vagueHedged(label, quote) : M.discloseSource(label, l?.source ?? 'policy'); break;
    case 'parent': body = M.vagueParent(label, labelOf(l!.category), quote); break;
    case 'child': body = M.vagueChild(label, labelOf(l!.category), quote); break;
    case 'umbrella': body = M.vagueUmbrella(label, quote); break;
    case 'not_collected': body = M.contradictedSaid(label, quote); break;
    case 'parent_not_collected': body = M.contradictedParent(label, labelOf(l!.category), quote); break;
    case 'weaker_variant': body = M.contradictedWeaker(label, labelOf(l!.category), quote); break;
    default: body = M.notDisclosed(label);
  }
  return body;
}

/** Compare every classified column to the confirmed policy. Columns with no category are skipped. */
export function checkCollection(cols: ColumnFact[], policy: Policy): Finding[] {
  const out: Finding[] = [];
  for (const col of cols) {
    if (!col.category || !isCategory(col.category)) continue;
    const c = classifyFinding(col.category, policy);
    const cites = crosswalk(col.category);
    const text = describe(col.category, c) + (c.cls === 'disclosed' || !cites.length ? '' : ' ' + M.related([...new Set(cites.map((x) => x.cite))].slice(0, 3).join('; ')));
    out.push({
      table: col.table, column: col.column, category: col.category, cls: c.cls, why: c.why,
      provisional: !col.confirmed && col.confidence < MIN_CONFIDENT, line: c.line, text, citations: cites,
    });
  }
  return out;
}
