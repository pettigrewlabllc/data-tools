import { parse } from 'yaml';
import { RULES_YAML } from './rules.data';
import { matchesSelector } from './taxonomy';

export interface Rule {
  id: string; title: string; summary: string; sources: string[];
  when: { any?: string[]; all?: { any: string[] }[] };
}
export interface RuleHit { rule: Rule; /** The categories that satisfied the rule, per clause. */ matched: string[] }

export function parseRules(text: string): { status: string; rules: Rule[] } {
  const d = parse(text) as { status: string; rules: Rule[] };
  if (!d?.rules?.length) throw new Error('rules.yml has no rules');
  for (const r of d.rules) {
    if (!r.id || !r.sources?.length || !r.when) throw new Error(`rule ${r.id ?? '?'} needs an id, sources and a condition`);
  }
  return d;
}

const loaded = parseRules(RULES_YAML);
export const RULES: Rule[] = loaded.rules;
export const RULES_STATUS: string = loaded.status;

const pick = (cats: string[], selectors: string[]) => cats.filter((c) => selectors.some((s) => matchesSelector(c, s)));

/** Which rules fire for a set of category ids. Deterministic: the same set always gives the same hits. */
export function evaluateRules(categories: Iterable<string>, rules: Rule[] = RULES): RuleHit[] {
  const cats = [...new Set(categories)].sort();
  const hits: RuleHit[] = [];
  for (const rule of rules) {
    let matched: string[] = [];
    if (rule.when.any) matched = pick(cats, rule.when.any);
    else if (rule.when.all) {
      const groups = rule.when.all.map((g) => pick(cats, g.any));
      if (groups.every((g) => g.length > 0)) matched = [...new Set(groups.flat())];
    }
    if (matched.length) hits.push({ rule, matched });
  }
  return hits;
}
