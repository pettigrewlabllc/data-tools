/**
 * Every finding, option, reason and rule sentence the engine produces lives here, so the wording can be reviewed
 * and rewritten in one place. Copy pass done 2026-11-14, awaiting Joel's sign-off.
 */
import type { FindingClass } from './check';

export const CATEGORY_LABEL: Record<string, string> = {
  user: 'personal information',
  'user.name': 'name',
  'user.contact': 'contact details',
  'user.contact.email': 'email address',
  'user.contact.phone_number': 'phone number',
  'user.contact.address': 'address',
  'user.contact.address.street': 'street address',
  'user.contact.address.city': 'city',
  'user.contact.address.state': 'state or province',
  'user.contact.address.postal_code': 'ZIP or postal code',
  'user.contact.address.country': 'country',
  'user.contact.url': 'profile or website link',
  'user.location': 'location',
  'user.location.precise': 'precise location',
  'user.location.imprecise': 'approximate location',
  'user.device': 'device information',
  'user.device.ip_address': 'IP address',
  'user.device.device_id': 'device identifier',
  'user.device.cookie_id': 'cookie or tracking identifier',
  'user.unique_id': 'user or account ID',
  'user.vehicle_id': 'vehicle identifier',
  'user.credentials': 'login credentials',
  'user.government_id': 'government ID',
  'user.government_id.national_identification_number': 'national ID or social security number',
  'user.government_id.drivers_license_number': "driver's license number",
  'user.government_id.passport_number': 'passport number',
  'user.financial': 'payment card details',
  'user.financial.bank_account': 'bank account',
  'user.demographic': 'demographic details',
  'user.demographic.date_of_birth': 'date of birth',
  'user.demographic.age_range': 'age or age range',
  'user.demographic.gender': 'gender',
  'user.demographic.race_ethnicity': 'race or ethnicity',
  'user.sexual_orientation': 'sexual orientation',
  'user.religious_belief': 'religious belief',
  'user.political_opinion': 'political opinion',
  'user.union_membership': 'trade union membership',
  'user.health_and_medical': 'health information',
  'user.health_and_medical.record_number': 'medical record number',
  'user.health_and_medical.insurance_id': 'health insurance ID',
  'user.biometric': 'biometric data',
  'user.genetic': 'genetic data',
  'user.image': 'photo or image of a person',
  'user.childrens': "children's data",
  'user.workplace': 'work or employment details',
  'user.behavior': 'activity and browsing history',
  'user.content': 'content you create',
  'user.content.message': 'message content',
};
export const labelOf = (id: string) => CATEGORY_LABEL[id] ?? id;

export const STATUS_LABEL = { disclosed: 'Disclosed', vague: 'Vague', not_collected: 'Says not collected' } as const;

export const CLASS_LABEL: Record<FindingClass, string> = {
  disclosed: 'Disclosed',
  vague: 'Disclosed only vaguely',
  not_disclosed: 'Not disclosed',
  contradicted: 'Contradicted',
};
export const CLASS_ORDER: FindingClass[] = ['contradicted', 'not_disclosed', 'vague', 'disclosed'];
export const CLASS_HELP: Record<FindingClass, string> = {
  disclosed: 'The notice names it.',
  vague: 'The notice only covers it through a broader or hedged line.',
  not_disclosed: 'No sentence in the notice covers it.',
  contradicted: "The notice says it doesn't collect it, or lists only a weaker version.",
};

export const PURPOSE_LABEL: Record<string, string> = {
  provide_service: 'Provide the service', analytics: 'Analytics', advertising: 'Advertising and marketing', security_fraud: 'Security and fraud',
  legal: 'Legal obligations', research: 'Research and improving the product', communications: 'Communicating with you', personalisation: 'Personalisation',
};

export const OPTION_LABEL: Record<string, string> = {
  generalise: 'Generalise', aggregate: 'Aggregate', suppress_rare: 'Suppress rare values', drop: 'Drop the column',
  restrict: 'Restrict access', update_notice: 'Update the notice', hash: 'Hash it',
};
export const OPTION_DETAIL = {
  aggregate: 'keep counts by group instead of one row per person',
  suppress_rare: (k: number) => `blank out values that fewer than ${k} rows share`,
  drop: 'remove the column',
  restrict: 'limit who can read it',
  update_notice: 'name it in the notice',
  hash: 'replace with a one-way hash',
};
export const GENERALISE_DETAIL: Record<string, string> = {
  'user.contact.address.postal_code': 'ZIP to its first 3 digits',
  'user.demographic.date_of_birth': 'date of birth to the year',
  'user.location.precise': 'latitude and longitude to 1 decimal place (about 11 km)',
  'user.device.ip_address': 'IPv4 address to its first three parts',
};

export const M = {
  // classifier reasons
  reasonName: (token: string) => `The column name has "${token}" in it.`,
  reasonTable: (table: string) => `The table name (${table}) is about people.`,
  reasonValues: (what: string, share: number) => `${Math.round(share * 100)}% of the values look like ${what}.`,
  reasonDecimals: (n: number, precise: boolean) => (precise ? `Values carry ${n} decimal places, which is street-level precision.` : `Values carry ${n} decimal places, which is rounded to a neighbourhood or wider.`),
  reasonBirthDates: () => 'The values are dates spread across several decades, like birth dates.',
  reasonType: (type: string) => `The column type is ${type}.`,
  reasonModifier: () => `There's a word like "opt", "count" or "status" in the name, so it may describe the data rather than hold it.`,
  noReason: 'No sign that this holds personal information.',
  needsConfirming: 'Needs confirming',
  confident: 'Confident',

  // collection findings
  disclosed: (label: string, quote: string) => `Your notice lists ${label}: "${quote}"`,
  discloseSource: (label: string, source: string) => `The policy lists ${label} (from ${source}), with no notice sentence behind it.`,
  vagueUmbrella: (label: string, quote: string) => `Your notice covers ${label} only in general terms: "${quote}"`,
  vagueHedged: (label: string, quote: string) => `Your notice mentions ${label}, but in general or hedged wording: "${quote}"`,
  vagueParent: (label: string, parent: string, quote: string) => `Your notice lists ${parent}, which is broader than ${label}: "${quote}"`,
  vagueChild: (label: string, child: string, quote: string) => `Your notice lists only ${child}, which is narrower than ${label}: "${quote}"`,
  notDisclosed: (label: string) => `No sentence in your notice mentions ${label}.`,
  contradictedSaid: (label: string, quote: string) => `Your notice says it does not collect ${label}: "${quote}"`,
  contradictedParent: (label: string, parent: string, quote: string) => `Your notice says it does not collect ${parent}, which includes ${label}: "${quote}"`,
  contradictedWeaker: (label: string, weaker: string, quote: string) => `Your notice lists only ${weaker}: "${quote}" This column looks like ${label}.`,
  related: (cites: string) => `Related rule: ${cites}.`,
  provisionalNote: 'Not counted until you confirm the column.',

  // options
  hashNote: 'Pseudonymises. It is still personal data.',
  restrictedNote: 'Access is restricted. The data itself is unchanged.',
  optionDone: (label: string) => `Applied: ${label}`,
  removedFromData: (label: string) => `${label} is no longer in the data.`,
  becomes: (from: string, to: string) => `${from} becomes ${to}.`,
  noticeWillList: (label: string) => `Add a sentence to the notice that names ${label}.`,

  // combination
  combinationBrings: (n: number, tables: number) => `Together these ${tables} tables bring ${n} categories of personal information into one place.`,
  combinationOnly: 'Fires only in the combination',
  because: (cats: string[]) => `Because the tables hold: ${cats.map(labelOf).join(', ')}.`,
  firesInTable: (table: string) => `Already fires in ${table}.`,
  noRuleFires: 'None of the rules fire on these categories.',

  // uniqueness
  uniqueSummary: (unique: number, total: number, share: number, label: string) => `${unique} of ${total} ${label} (${Math.round(share * 1000) / 10}%) are unique in this dataset on these columns.`,
  uniqueLabel: 'unique in this dataset',
  uniqueEntities: 'entities',
  uniqueRows: 'rows',
  noQi: 'No quasi-identifier columns are confirmed yet.',
  smallestSubsets: 'Smallest column sets that make at least half of them unique',
  noSubsets: 'No set of up to 3 columns makes half of them unique.',

  // ai
  aiRejectedQuote: (cat: string) => `A model line for ${cat} was dropped because its quote is not in your notice.`,
  aiRejectedCategory: (cat: string) => `A model line was dropped because "${cat}" is not a category this tool knows.`,

  // errors
  notAPolicy: "This isn't a policy.yml from PrivacyDiff.",
} as const;

/** The text a rule contributes to the page is in rules.yml. This is how the engine words a hit. */
export const RULE_HIT = {
  because: (cats: string) => `Because the data holds: ${cats}.`,
};
