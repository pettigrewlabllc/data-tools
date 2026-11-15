import { describe, it, expect } from 'vitest';
import {
  splitSentences, draftPolicy, policyToYaml, policyFromYaml, importFides, importDpv, policyFromTicked, tickGroups,
  checkCollection, type ColumnFact, type Policy,
} from '../src';

const fact = (table: string, column: string, category: string, confirmed = true): ColumnFact => ({ table, column, category, confidence: 0.9, confirmed });
const line = (p: Policy, cat: string) => p.categories.find((l) => l.category === cat);

describe('splitSentences', () => {
  it('splits sentences, bullets and paragraphs, and keeps U.S. and e.g. whole', () => {
    const s = splitSentences('We collect your name. We use it e.g. to greet you.\n\n- email address\n- phone number\n\nOperating in the U.S. is fine.');
    expect(s.map((x) => x.text)).toEqual(['We collect your name.', 'We use it e.g. to greet you.', 'email address', 'phone number', 'Operating in the U.S. is fine.']);
    expect(s.map((x) => x.paragraph)).toEqual([1, 1, 2, 2, 3]);
  });
});

describe('draftPolicy', () => {
  it('explicit disclosure, with the sentence quoted', () => {
    const p = draftPolicy('We collect your name and email address.');
    expect(line(p, 'user.contact.email')).toMatchObject({ status: 'disclosed', sentence: 's1', quote: 'We collect your name and email address.' });
    expect(line(p, 'user.name')?.status).toBe('disclosed');
  });
  it('"may collect" is vague', () => {
    expect(line(draftPolicy('We may collect your phone number.'), 'user.contact.phone_number')?.status).toBe('vague');
  });
  it('a rights sentence with "may" is not a hedge on collection', () => {
    expect(line(draftPolicy('You may update your email address in settings.'), 'user.contact.email')?.status).toBe('disclosed');
  });
  it('umbrella words are vague: identifiers cover name, contact, id and device', () => {
    const p = draftPolicy('We collect identifiers and commercial information.');
    for (const c of ['user.name', 'user.contact', 'user.unique_id', 'user.device']) expect(line(p, c)?.status, c).toBe('vague');
  });
  it('device identifiers is not the identifiers umbrella', () => {
    const p = draftPolicy('We collect device identifiers.');
    expect(line(p, 'user.device.device_id')?.status).toBe('disclosed');
    expect(line(p, 'user.name')).toBeUndefined();
  });
  it('"personal information" with nothing specific is a root umbrella; a heading is not', () => {
    expect(line(draftPolicy('We collect personal information.'), 'user')?.status).toBe('vague');
    expect(line(draftPolicy('The personal information we collect'), 'user')).toBeUndefined();
  });
  it('negation: "we do not collect" is not_collected, only for the negated clause', () => {
    const p = draftPolicy('We collect your email address but we do not collect precise geolocation.');
    expect(line(p, 'user.contact.email')?.status).toBe('disclosed');
    expect(line(p, 'user.location.precise')?.status).toBe('not_collected');
  });
  it('"we do not sell your email" is not a statement that email is not collected', () => {
    expect(line(draftPolicy('We do not sell your email address.'), 'user.contact.email')?.status).toBe('disclosed');
  });
  it('"we do not use cookies" counts for tracking technologies only', () => {
    const p = draftPolicy('We do not use cookies. We do not use your name for advertising.');
    expect(line(p, 'user.device.cookie_id')?.status).toBe('not_collected');
    expect(line(p, 'user.name')?.status).toBe('disclosed');
  });
  it('approximate and precise location are different lines; plain location is the parent', () => {
    expect(line(draftPolicy('We collect your approximate location.'), 'user.location.imprecise')?.status).toBe('disclosed');
    expect(line(draftPolicy('We collect your approximate location.'), 'user.location')).toBeUndefined();
    expect(line(draftPolicy('We collect your location.'), 'user.location')?.status).toBe('disclosed');
  });
  it('purposes are read from the notice', () => {
    const p = draftPolicy('We use your data to provide the service and for analytics.');
    expect(p.purposes.map((x) => x.purpose)).toEqual(expect.arrayContaining(['provide_service', 'analytics']));
  });
  it('is deterministic', () => {
    const t = 'We collect your name. We may collect health information.';
    expect(JSON.stringify(draftPolicy(t))).toBe(JSON.stringify(draftPolicy(t)));
  });
  it('lists sensitive categories it disclosed', () => {
    expect(draftPolicy('We collect health information.').sensitive).toContain('user.health_and_medical');
  });
});

describe('policy.yml', () => {
  it('round-trips', () => {
    const p = draftPolicy('We collect your name and email address.\n\nWe do not collect precise geolocation. We may collect health information.');
    const back = policyFromYaml(policyToYaml(p));
    expect(back).toEqual(p);
    expect(policyToYaml(p)).toMatch(/^tool: privacydiff\nversion: /);
  });
  it('rejects a file from another tool, a newer major version, or an unknown category', () => {
    expect(() => policyFromYaml('tool: other\n')).toThrow(/not a policy/);
    expect(() => policyFromYaml('tool: privacydiff\nversion: 9.0.0\ncategories: []\n')).toThrow(/pinned to version 9.0.0/);
    expect(() => policyFromYaml('tool: privacydiff\nversion: 0.1.0\ncategories:\n  - {category: user.nope, status: disclosed}\n')).toThrow(/unknown category/);
  });
});

describe('imports', () => {
  it('reads Fides system and dataset YAML', () => {
    const r = importFides(`
system:
  - fides_key: app
    privacy_declarations:
      - data_use: analytics.reporting
        data_categories: [user.contact.email, user.location.imprecise, user.made_up]
dataset:
  - fides_key: db
    collections:
      - name: users
        fields:
          - name: phone
            data_categories: [user.contact.phone_number]`);
    expect(r.policy.categories.map((c) => c.category)).toEqual(['user.contact.email', 'user.contact.phone_number', 'user.location.imprecise']);
    expect(r.policy.categories.every((c) => c.status === 'disclosed' && c.source === 'fides')).toBe(true);
    expect(r.unrecognised).toEqual(['user.made_up']);
    expect(r.policy.purposes[0].purpose).toBe('analytics.reporting');
  });
  it('reads a minimal DPV JSON-LD file', () => {
    const r = importDpv(JSON.stringify({
      '@context': { dpv: 'https://w3id.org/dpv#', 'dpv-pd': 'https://w3id.org/dpv/pd#' },
      '@graph': [{ '@id': 'ex:p', '@type': 'dpv:PersonalDataHandling', 'dpv:hasPersonalData': [{ '@id': 'dpv-pd:EmailAddress' }, { '@id': 'dpv-pd:PreciseLocation' }, { '@id': 'dpv-pd:Hat' }] }],
    }));
    expect(r.policy.categories.map((c) => c.category)).toEqual(['user.contact.email', 'user.location.precise']);
    expect(r.unrecognised).toEqual(['Hat']);
  });
  it('ticked categories are disclosed with no sentence', () => {
    const p = policyFromTicked(['user.contact.email', 'user.name', 'nope']);
    expect(p.categories).toEqual([
      { category: 'user.contact.email', status: 'disclosed', source: 'ticked' },
      { category: 'user.name', status: 'disclosed', source: 'ticked' },
    ]);
    expect(tickGroups().flatMap((g) => g.categories)).toContain('user.biometric');
  });
});

describe('checkCollection: the four classes', () => {
  const notice = [
    'We collect your name and email address.',
    'We may collect your phone number.',
    'We collect your approximate location.',
    'We do not collect your Social Security number.',
    'We collect contact details for billing.',
  ].join('\n\n');
  const p = draftPolicy(notice);
  const f = checkCollection([
    fact('t', 'email', 'user.contact.email'), fact('t', 'phone', 'user.contact.phone_number'), fact('t', 'lat', 'user.location.precise'),
    fact('t', 'ssn', 'user.government_id.national_identification_number'), fact('t', 'dob', 'user.demographic.date_of_birth'),
    fact('t', 'zip', 'user.contact.address.postal_code'), fact('t', 'nm', 'user.name'),
  ], p);
  const by = (c: string) => f.find((x) => x.column === c)!;
  it('disclosed', () => { expect(by('email').cls).toBe('disclosed'); expect(by('nm').cls).toBe('disclosed'); });
  it('vague: hedged, or covered by a broader line', () => {
    expect(by('phone').cls).toBe('vague');
    expect(by('zip')).toMatchObject({ cls: 'vague', why: 'parent' });
  });
  it('not disclosed', () => { expect(by('dob')).toMatchObject({ cls: 'not_disclosed', why: 'none' }); });
  it('contradicted: says not collected', () => { expect(by('ssn')).toMatchObject({ cls: 'contradicted', why: 'not_collected' }); });
  it('contradicted: lists only a weaker variant (approximate location vs precise)', () => {
    expect(by('lat')).toMatchObject({ cls: 'contradicted', why: 'weaker_variant' });
    expect(by('lat').text).toContain('approximate location');
    expect(by('lat').text).toContain('We collect your approximate location.');
  });
  it('each finding quotes the sentence or says none matched, and cites the rule', () => {
    expect(by('email').text).toContain('"We collect your name and email address."');
    expect(by('dob').text).toMatch(/No sentence in your notice/);
    expect(by('dob').text).toMatch(/Related rule: .*1798\.140/);
  });
  it('a low-confidence unconfirmed column is provisional', () => {
    const g = checkCollection([{ table: 't', column: 'name', category: 'user.name', confidence: 0.5, confirmed: false }], p);
    expect(g[0].provisional).toBe(true);
    expect(checkCollection([{ table: 't', column: 'name', category: 'user.name', confidence: 0.5, confirmed: true }], p)[0].provisional).toBe(false);
  });
});
