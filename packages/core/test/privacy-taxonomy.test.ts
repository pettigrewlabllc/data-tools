import { describe, it, expect } from 'vitest';
import { CATEGORIES, BY_ID, ancestors, matchesSelector, crosswalk, getCategory, HIPAA_IDENTIFIERS, CATEGORY_LABEL, tagsOf } from '../src';

describe('taxonomy', () => {
  it('has unique ids, fideslang-shaped, each with a label', () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
    for (const c of CATEGORIES) {
      expect(c.id === 'user' || c.id.startsWith('user.')).toBe(true);
      expect(CATEGORY_LABEL[c.id], c.id).toBeTruthy();
    }
    expect(Object.keys(CATEGORY_LABEL).every((id) => BY_ID.has(id))).toBe(true);
  });
  it('every parent id exists', () => {
    for (const c of CATEGORIES) for (const a of ancestors(c.id)) expect(BY_ID.has(a), `${c.id} → ${a}`).toBe(true);
  });
  it('covers all 18 HIPAA Safe Harbor letters', () => {
    const letters = new Set(CATEGORIES.flatMap((c) => c.hipaa ?? []));
    for (const l of Object.keys(HIPAA_IDENTIFIERS)) expect(letters.has(l), `HIPAA (${l})`).toBe(true);
    expect(Object.keys(HIPAA_IDENTIFIERS)).toHaveLength(18);
  });
  it('crosswalk cites the exact subsection', () => {
    expect(crosswalk('user.contact.email').map((x) => x.cite)).toContain('45 CFR §164.514(b)(2)(i)(F)');
    expect(crosswalk('user.location.precise').map((x) => x.cite)).toContain('Cal. Civ. Code §1798.140(ae)(1)');
    expect(crosswalk('user.health_and_medical').map((x) => x.cite)).toContain('GDPR Art. 9(1)');
    expect(crosswalk('user.childrens').map((x) => x.cite)).toContain('16 CFR §312.2');
  });
  it('marks direct and quasi identifiers', () => {
    expect(getCategory('user.contact.email').kind).toBe('direct');
    expect(getCategory('user.contact.address.postal_code').kind).toBe('quasi');
  });
  it('selectors: exact, prefix and tag', () => {
    expect(matchesSelector('user.location.precise', 'user.location.*')).toBe(true);
    expect(matchesSelector('user.location.precise', 'user.location')).toBe(false);
    expect(matchesSelector('user.biometric', '@gdpr_art9')).toBe(true);
    expect(tagsOf('user.contact.email')).toContain('@hipaa_identifier');
  });
});
