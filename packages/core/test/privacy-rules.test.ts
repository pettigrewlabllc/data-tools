import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RULES, RULES_STATUS, parseRules, evaluateRules, checkCombination } from '../src';
import { RULES_YAML } from '../src/privacy/rules.data';

const YML = new URL('../src/privacy/rules.yml', import.meta.url);
const ids = (cats: string[]) => evaluateRules(cats).map((h) => h.rule.id);

describe('rules.yml', () => {
  it('is what the engine loads: the generated module equals the file, and the engine rules equal the parsed file', () => {
    const text = readFileSync(YML, 'utf8');
    expect(RULES_YAML).toBe(text); // if this fails: npm run privacy:rules
    expect(RULES).toEqual(parseRules(text).rules);
  });
  it('is marked as a draft', () => {
    expect(readFileSync(YML, 'utf8').split('\n')[0]).toMatch(/^# status: draft — rule set to be authored\/approved by Joel/);
    expect(RULES_STATUS).toBe('draft — rule set to be authored/approved by Joel');
  });
  it('every rule has an id, a title, a summary, sources and a condition', () => {
    for (const r of RULES) {
      expect(r.id && r.title && r.summary && r.sources.length).toBeTruthy();
      expect(r.when.any ?? r.when.all).toBeTruthy();
    }
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });
});

describe('rule engine', () => {
  it('GDPR Art. 9 special category', () => {
    expect(ids(['user.religious_belief'])).toContain('gdpr-art9-special-category');
    expect(ids(['user.contact.email'])).toEqual([]);
  });
  it('CPRA sensitive personal information', () => {
    expect(ids(['user.location.precise'])).toContain('cpra-sensitive-personal-information');
    expect(ids(['user.government_id.passport_number'])).toContain('cpra-sensitive-personal-information');
    expect(ids(['user.demographic.gender'])).not.toContain('cpra-sensitive-personal-information');
  });
  it('HIPAA identifier together with health data, not either alone', () => {
    expect(ids(['user.contact.email', 'user.health_and_medical'])).toContain('hipaa-identifier-with-health');
    expect(ids(['user.contact.email'])).not.toContain('hipaa-identifier-with-health');
    expect(ids(['user.health_and_medical'])).not.toContain('hipaa-identifier-with-health');
  });
  it('data about children under 13', () => { expect(ids(['user.childrens'])).toContain('coppa-child-under-13'); });
  it('precise geolocation with a direct identifier', () => {
    expect(ids(['user.location.precise', 'user.device.ip_address'])).toContain('precise-geolocation-with-direct-identifier');
    expect(ids(['user.location.precise'])).not.toContain('precise-geolocation-with-direct-identifier');
    expect(ids(['user.location.imprecise', 'user.contact.email'])).not.toContain('precise-geolocation-with-direct-identifier');
  });
  it('is deterministic and order-independent', () => {
    expect(ids(['user.health_and_medical', 'user.contact.email'])).toEqual(ids(['user.contact.email', 'user.health_and_medical']));
  });
});

describe('checkCombination', () => {
  it('reports what the tables bring together and the rules that fire only in the combination', () => {
    const r = checkCombination([
      { table: 'members', categories: ['user.contact.email', 'user.name'] },
      { table: 'visits', categories: ['user.health_and_medical'] },
    ]);
    expect(r.union).toEqual(['user.contact.email', 'user.health_and_medical', 'user.name']);
    expect(r.combinationOnly.map((h) => h.rule.id)).toEqual(['hipaa-identifier-with-health']);
    expect(r.perTable.find((t) => t.table === 'visits')!.hits.map((h) => h.rule.id)).toContain('gdpr-art9-special-category');
  });
  it('a rule that already fires in one table is not "combination only"', () => {
    const r = checkCombination([{ table: 'a', categories: ['user.religious_belief'] }, { table: 'b', categories: ['user.name'] }]);
    expect(r.combinationOnly).toEqual([]);
    expect(r.hits.map((h) => h.rule.id)).toContain('gdpr-art9-special-category');
  });
});
