/**
 * Personal-information categories. Ids follow fideslang's `user.*` shape so a policy can be exchanged with a Fides
 * setup; a few ids are PrivacyDiff additions (marked `extra`). Each category carries a crosswalk to the rule texts
 * the tool cites. Subsection letters are only given where they are known; otherwise the section alone is cited.
 */
export type IdKind = 'direct' | 'quasi' | 'other';

export interface Category {
  id: string;
  kind: IdKind;
  /** The CPRA personal information category names (Cal. Civ. Code §1798.140(v)(1)) this belongs to. */
  cpra: string[];
  /** Cal. Civ. Code §1798.140(ae) sensitive personal information: the paragraph that lists it. */
  cpraSensitive?: string;
  /** GDPR Art. 9(1) special category. */
  gdpr9?: string;
  /** HIPAA Safe Harbor identifier letters, 45 CFR §164.514(b)(2)(i)(A)-(R). */
  hipaa?: string[];
  /** Data about children under 13: 16 CFR §312.2. */
  coppa?: boolean;
  /** Categories that are a weaker or narrower form of this one. A notice that lists only one of them does not cover this. */
  weakerVariants?: string[];
  /** Not in fideslang's published list. */
  extra?: boolean;
}

export const CPRA_SECTION = 'Cal. Civ. Code §1798.140(v)(1)';
export const CPRA_SENSITIVE_SECTION = 'Cal. Civ. Code §1798.140';
export const GDPR9 = 'GDPR Art. 9(1)';
export const HIPAA_SECTION = '45 CFR §164.514(b)(2)(i)';
export const COPPA_SECTION = '16 CFR §312.2';

export const HIPAA_IDENTIFIERS: Record<string, string> = {
  A: 'Names', B: 'Geographic subdivisions smaller than a State', C: 'Dates (except year) tied to an individual',
  D: 'Telephone numbers', E: 'Fax numbers', F: 'Email addresses', G: 'Social security numbers', H: 'Medical record numbers',
  I: 'Health plan beneficiary numbers', J: 'Account numbers', K: 'Certificate or license numbers',
  L: 'Vehicle identifiers and serial numbers', M: 'Device identifiers and serial numbers', N: 'Web URLs',
  O: 'IP address numbers', P: 'Biometric identifiers', Q: 'Full-face photographs and comparable images',
  R: 'Any other unique identifying number, characteristic, or code',
};

const ID = 'Identifiers', REC = 'Customer records (Cal. Civ. Code §1798.80(e))', GEO = 'Geolocation data', PROT = 'Protected classifications',
  COM = 'Commercial information', NET = 'Internet or other electronic network activity', BIO = 'Biometric information',
  PRO = 'Professional or employment-related information', SENS = 'Sensitive personal information';

function c(id: string, kind: IdKind, rest: Partial<Omit<Category, 'id' | 'kind'>> = {}): Category {
  return { id, kind, cpra: [], ...rest };
}

export const CATEGORIES: Category[] = [
  c('user', 'other'),
  c('user.name', 'direct', { cpra: [ID, REC], hipaa: ['A'] }),
  c('user.contact', 'other', { cpra: [ID, REC] }),
  c('user.contact.email', 'direct', { cpra: [ID], hipaa: ['F'] }),
  c('user.contact.phone_number', 'direct', { cpra: [REC], hipaa: ['D', 'E'] }),
  c('user.contact.address', 'other', { cpra: [ID, REC] }),
  c('user.contact.address.street', 'direct', { cpra: [ID, REC], hipaa: ['B'] }),
  c('user.contact.address.city', 'quasi', { cpra: [ID, REC], hipaa: ['B'] }),
  c('user.contact.address.state', 'quasi', { cpra: [ID, REC] }),
  c('user.contact.address.postal_code', 'quasi', { cpra: [ID, REC], hipaa: ['B'] }),
  c('user.contact.address.country', 'quasi', { cpra: [ID, REC] }),
  c('user.contact.url', 'direct', { cpra: [ID], hipaa: ['N'], extra: true }),
  c('user.location', 'other', { cpra: [GEO] }),
  c('user.location.precise', 'quasi', { cpra: [GEO], cpraSensitive: '(ae)(1)', hipaa: ['B'], weakerVariants: ['user.location.imprecise'] }),
  c('user.location.imprecise', 'quasi', { cpra: [GEO] }),
  c('user.device', 'other', { cpra: [ID, NET] }),
  c('user.device.ip_address', 'direct', { cpra: [ID, NET], hipaa: ['O'] }),
  c('user.device.device_id', 'direct', { cpra: [ID, NET], hipaa: ['M'] }),
  c('user.device.cookie_id', 'direct', { cpra: [ID, NET], hipaa: ['R'] }),
  c('user.unique_id', 'direct', { cpra: [ID], hipaa: ['R'] }),
  c('user.vehicle_id', 'direct', { cpra: [ID], hipaa: ['L'], extra: true }),
  c('user.credentials', 'other', { cpra: [ID], cpraSensitive: '(ae)(1)' }),
  c('user.government_id', 'direct', { cpra: [ID, REC], cpraSensitive: '(ae)(1)', hipaa: ['K'] }),
  c('user.government_id.national_identification_number', 'direct', { cpra: [ID, REC], cpraSensitive: '(ae)(1)', hipaa: ['G'] }),
  c('user.government_id.drivers_license_number', 'direct', { cpra: [ID, REC], cpraSensitive: '(ae)(1)', hipaa: ['K'] }),
  c('user.government_id.passport_number', 'direct', { cpra: [ID, REC], cpraSensitive: '(ae)(1)', hipaa: ['R'] }),
  c('user.financial', 'direct', { cpra: [REC], cpraSensitive: '(ae)(1)', hipaa: ['J'] }),
  c('user.financial.bank_account', 'direct', { cpra: [REC], cpraSensitive: '(ae)(1)', hipaa: ['J'] }),
  c('user.demographic', 'other', { cpra: [PROT] }),
  c('user.demographic.date_of_birth', 'quasi', { cpra: [PROT], hipaa: ['C'], weakerVariants: ['user.demographic.age_range'] }),
  c('user.demographic.age_range', 'quasi', { cpra: [PROT] }),
  c('user.demographic.gender', 'quasi', { cpra: [PROT] }),
  c('user.demographic.race_ethnicity', 'quasi', { cpra: [PROT], cpraSensitive: '(ae)(1)', gdpr9: 'racial or ethnic origin' }),
  c('user.sexual_orientation', 'quasi', { cpra: [PROT], cpraSensitive: '(ae)(2)', gdpr9: 'sex life or sexual orientation' }),
  c('user.religious_belief', 'quasi', { cpra: [PROT], cpraSensitive: '(ae)(1)', gdpr9: 'religious or philosophical beliefs' }),
  c('user.political_opinion', 'quasi', { cpra: [PROT], gdpr9: 'political opinions' }),
  c('user.union_membership', 'quasi', { cpra: [PROT], cpraSensitive: '(ae)(1)', gdpr9: 'trade union membership' }),
  c('user.health_and_medical', 'other', { cpra: [REC, PROT], cpraSensitive: '(ae)(2)', gdpr9: 'data concerning health' }),
  c('user.health_and_medical.record_number', 'direct', { cpra: [REC], hipaa: ['H'], extra: true }),
  c('user.health_and_medical.insurance_id', 'direct', { cpra: [REC], hipaa: ['I'], extra: true }),
  c('user.biometric', 'direct', { cpra: [BIO], cpraSensitive: '(ae)(2)', gdpr9: 'biometric data for uniquely identifying a person', hipaa: ['P'] }),
  c('user.genetic', 'other', { cpra: [PROT], cpraSensitive: '(ae)(1)', gdpr9: 'genetic data' }),
  c('user.image', 'direct', { cpra: ['Audio, electronic, visual, thermal, olfactory or similar information'], hipaa: ['Q'], extra: true }),
  c('user.childrens', 'other', { cpra: [PROT], coppa: true }),
  c('user.workplace', 'quasi', { cpra: [PRO] }),
  c('user.behavior', 'other', { cpra: [COM, NET] }),
  c('user.content', 'other', { cpra: [NET], extra: true }),
  c('user.content.message', 'other', { cpra: [NET], cpraSensitive: '(ae)(1)', extra: true }),
];

export const BY_ID = new Map(CATEGORIES.map((x) => [x.id, x]));
export const isCategory = (id: string) => BY_ID.has(id);
export const getCategory = (id: string): Category => {
  const x = BY_ID.get(id);
  if (!x) throw new Error(`unknown category ${id}`);
  return x;
};

/** `user.contact.email` → ['user.contact', 'user'] (nearest first). */
export function ancestors(id: string): string[] {
  const parts = id.split('.');
  const out: string[] = [];
  for (let i = parts.length - 1; i >= 1; i--) out.push(parts.slice(0, i).join('.'));
  return out;
}

/** The tags a rule can select on, beyond an exact id. */
export function tagsOf(id: string): string[] {
  const k = BY_ID.get(id);
  if (!k) return [];
  const t: string[] = [];
  if (k.gdpr9) t.push('@gdpr_art9');
  if (k.cpraSensitive) t.push('@cpra_sensitive');
  if (k.hipaa?.length) t.push('@hipaa_identifier');
  if (k.kind === 'direct') t.push('@direct_identifier');
  if (k.kind === 'quasi') t.push('@quasi_identifier');
  if (k.coppa) t.push('@childrens');
  return t;
}

/** A selector is an exact id, an id ending in `.*` (it and everything under it), or an `@tag`. */
export function matchesSelector(id: string, selector: string): boolean {
  if (selector.startsWith('@')) return tagsOf(id).includes(selector);
  if (selector.endsWith('.*')) { const p = selector.slice(0, -2); return id === p || id.startsWith(p + '.'); }
  return id === selector;
}

/** The citations behind one category, for display. */
export function crosswalk(id: string): { framework: string; cite: string; note: string }[] {
  const k = getCategory(id);
  const out: { framework: string; cite: string; note: string }[] = [];
  for (const n of k.cpra) out.push({ framework: 'CPRA', cite: CPRA_SECTION, note: n });
  if (k.cpraSensitive) out.push({ framework: 'CPRA sensitive', cite: `${CPRA_SENSITIVE_SECTION}${k.cpraSensitive}`, note: 'Sensitive personal information' });
  if (k.gdpr9) out.push({ framework: 'GDPR', cite: GDPR9, note: k.gdpr9 });
  for (const l of k.hipaa ?? []) out.push({ framework: 'HIPAA', cite: `${HIPAA_SECTION}(${l})`, note: HIPAA_IDENTIFIERS[l] });
  if (k.coppa) out.push({ framework: 'COPPA', cite: COPPA_SECTION, note: 'Personal information from a child under 13' });
  return out;
}
