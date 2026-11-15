import { parse, stringify } from 'yaml';
import { BY_ID, CATEGORIES, getCategory, isCategory } from './taxonomy';

export const POLICY_VERSION = '0.1.0';

export interface Sentence { id: string; paragraph: number; text: string }
export type Status = 'disclosed' | 'vague' | 'not_collected';
export type LineSource = 'notice' | 'ai' | 'fides' | 'dpv' | 'ticked';
export interface PolicyLine { category: string; status: Status; sentence?: string; quote?: string; source?: LineSource }
export interface PolicyPurpose { purpose: string; sentence?: string }
export interface Policy {
  tool: 'privacydiff';
  version: string;
  categories: PolicyLine[];
  purposes: PolicyPurpose[];
  /** Categories the policy discloses that are sensitive under CPRA or GDPR Art. 9 (derived). */
  sensitive: string[];
  sentences: Sentence[];
}

export const emptyPolicy = (): Policy => ({ tool: 'privacydiff', version: POLICY_VERSION, categories: [], purposes: [], sensitive: [], sentences: [] });

// ---------- sentences ----------

const ABBR = /\b(e\.g|i\.e|etc|vs|inc|ltd|co|u\.s|u\.k|no|approx|esp|incl)\./gi;

export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  let paragraph = 0;
  for (const block of blocks) {
    if (!block.trim()) continue;
    paragraph++;
    const units: string[] = [];
    let buf: string[] = [];
    const flush = () => { if (buf.length) units.push(buf.join(' ')); buf = []; };
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (/^([-*•]|\d+[.)])\s+/.test(line)) { flush(); units.push(line.replace(/^([-*•]|\d+[.)])\s+/, '')); }
      else buf.push(line);
    }
    flush();
    for (const u of units) {
      const guarded = u.replace(ABBR, (m) => m.replace(/\./g, '\u0001'));
      const parts = guarded.split(/(?<=[.!?])["')\]]?\s+(?=[A-Z0-9"'(\[])/);
      for (const part of parts) {
        const t = part.replace(/\u0001/g, '.').trim();
        if (!t) continue;
        out.push({ id: `s${out.length + 1}`, paragraph, text: t });
      }
    }
  }
  return out;
}

// ---------- the drafter ----------

const L = (s: string) => new RegExp(s, 'i');
interface Phrase { cat: string; re: RegExp; /** Tracking technology: "we do not use cookies" counts as a statement that it is not collected. */ tracking?: boolean; /** A broader category that goes quiet when this one matched in the same clause. */ suppresses?: string[] }

const PHRASES: Phrase[] = [
  { cat: 'user.name', re: L(String.raw`(?<!\b(?:file|domain|user|company|product|brand|business|device|display|screen|host) )\b(?:your |full |first |last |legal )?names?\b(?! of (?:the|our|this))`) },
  { cat: 'user.contact.email', re: L(String.raw`\be-?mail(?: address(?:es)?)?\b`) },
  { cat: 'user.contact.phone_number', re: L(String.raw`\b(?:phone|telephone|mobile|cell)(?: ?numbers?)?\b|\bfax\b`) },
  { cat: 'user.contact.address.street', re: L(String.raw`\b(?:street|mailing|postal|home|billing|shipping|physical|delivery) address(?:es)?\b`) },
  { cat: 'user.contact.address', re: L(String.raw`(?<!e-?mail |ip |web |street |mailing |postal |home |billing |shipping |physical |delivery )\baddress(?:es)?\b`), suppresses: [] },
  { cat: 'user.contact.address.postal_code', re: L(String.raw`\b(?:zip ?codes?|postal ?codes?|postcodes?)\b`) },
  { cat: 'user.contact.address.city', re: L(String.raw`\bcity\b`) },
  { cat: 'user.contact.address.state', re: L(String.raw`(?<!the )\b(?:state|province)\b(?! of)`) },
  { cat: 'user.contact.address.country', re: L(String.raw`\bcountry\b`) },
  { cat: 'user.contact', re: L(String.raw`\bcontact (?:information|details|data)\b`) },
  { cat: 'user.location.precise', re: L(String.raw`\b(?:precise|exact|specific|real-?time|fine) (?:geo)?location\b|\bprecise geolocation\b|\bgps\b|\bgeolocation (?:coordinates|data)\b|\blatitude\b`), suppresses: ['user.location'] },
  { cat: 'user.location.imprecise', re: L(String.raw`\b(?:approximate|general|coarse|city-level|imprecise|rough|inferred|regional) (?:geo)?location\b|\blocation (?:at )?(?:the )?(?:city|region|country|zip) level\b`), suppresses: ['user.location'] },
  { cat: 'user.location', re: L(String.raw`\b(?:geo)?location(?: data| information)?\b`) },
  { cat: 'user.device.ip_address', re: L(String.raw`\bip address(?:es)?\b|\binternet protocol address(?:es)?\b`) },
  { cat: 'user.device.device_id', re: L(String.raw`\b(?:device|advertising|mobile|hardware) (?:ids?|identifiers?)\b|\bidfa\b|\baaid\b|\bimei\b|\bmac address(?:es)?\b`) },
  { cat: 'user.device', re: L(String.raw`\bdevice (?:information|data|details|type)\b|\bbrowser (?:type|information)\b`) },
  { cat: 'user.device.cookie_id', re: L(String.raw`\bcookies?\b|\bweb beacons?\b|\bpixels?\b|\btracking (?:technologies|identifiers?)\b`), tracking: true },
  { cat: 'user.unique_id', re: L(String.raw`\buser ?ids?\b|\baccount (?:ids?|identifiers?|numbers?)\b|\bunique (?:user |personal )?(?:identifiers?|ids?)\b|\b(?:customer|member|employee|student|user|account) (?:id|number|identifier)s?\b|\busernames?\b|\blogin (?:name|id)s?\b`) },
  { cat: 'user.credentials', re: L(String.raw`\bpasswords?\b|\bsecurity (?:questions?|answers?)\b|\blog-?in credentials\b`) },
  { cat: 'user.government_id.national_identification_number', re: L(String.raw`\bsocial security numbers?\b|\bssn\b|\btax identification numbers?\b|\bnational (?:id|identification)\w*\b`) },
  { cat: 'user.government_id.drivers_license_number', re: L(String.raw`\bdriver'?s? licen[sc]es?(?: numbers?)?\b`) },
  { cat: 'user.government_id.passport_number', re: L(String.raw`\bpassports?(?: numbers?)?\b`) },
  { cat: 'user.government_id', re: L(String.raw`\bgovernment[- ]issued (?:id|identification)\b`) },
  { cat: 'user.financial', re: L(String.raw`\b(?:credit|debit|payment) cards?(?: (?:numbers?|information|details))?\b|\bcard numbers?\b|\bpayment (?:information|details)\b|\bbilling information\b`) },
  { cat: 'user.financial.bank_account', re: L(String.raw`\bbank account(?: numbers?| information)?\b`) },
  { cat: 'user.demographic.date_of_birth', re: L(String.raw`\bdate of birth\b|\bbirth ?dates?\b|\bbirthdays?\b|\bdob\b`) },
  { cat: 'user.demographic.age_range', re: L(String.raw`(?<!years of )(?<!the )(?<!minimum )\bage(?: range| group| bracket)?\b(?! of| under| 13)`) },
  { cat: 'user.demographic.gender', re: L(String.raw`\bgender\b|\bsex\b(?! life)`) },
  { cat: 'user.demographic.race_ethnicity', re: L(String.raw`\brace\b|\bracial\b|\bethnic(?:ity| origin)?\b`) },
  { cat: 'user.sexual_orientation', re: L(String.raw`\bsexual orientation\b|\bsex life\b`) },
  { cat: 'user.religious_belief', re: L(String.raw`\breligio(?:n|us)(?: beliefs?)?\b`) },
  { cat: 'user.political_opinion', re: L(String.raw`\bpolitical (?:opinions?|views?|affiliation|beliefs?)\b`) },
  { cat: 'user.union_membership', re: L(String.raw`\b(?:trade )?union membership\b`) },
  { cat: 'user.health_and_medical.record_number', re: L(String.raw`\bmedical record numbers?\b|\bpatient (?:id|number)s?\b|\brecord numbers?\b`) },
  { cat: 'user.health_and_medical.insurance_id', re: L(String.raw`\b(?:health )?insurance (?:id|number|information|details|policy)s?\b`) },
  { cat: 'user.health_and_medical', re: L(String.raw`\bhealth (?:information|data|conditions?|records?)\b|\bmedical (?:information|data|history|records?|conditions?)\b|\bdiagnos(?:is|es)\b|\bmedications?\b|\bprescriptions?\b|\bsymptoms?\b|\btreatments?\b|\bhealth\b`) },
  { cat: 'user.biometric', re: L(String.raw`\bbiometric\w*\b|\bfingerprints?\b|\bface ?prints?\b|\bfacial recognition\b|\bvoice ?prints?\b|\biris scans?\b`) },
  { cat: 'user.genetic', re: L(String.raw`\bgenetic\b|\bdna\b|\bgenome\b`) },
  { cat: 'user.image', re: L(String.raw`\bphotos?\b|\bphotographs?\b|\bselfies?\b|\bprofile (?:pictures?|photos?|images?)\b|\bavatars?\b`) },
  { cat: 'user.childrens', re: L(String.raw`\bchildren\b|\bchild\b|\bminors?\b|\bunder (?:the age of )?13\b`) },
  { cat: 'user.workplace', re: L(String.raw`\bemployer\b|\bjob titles?\b|\boccupation\b|\bprofession\b|\bemployment (?:information|history)\b`) },
  { cat: 'user.behavior', re: L(String.raw`\bbrowsing history\b|\bsearch (?:history|queries)\b|\bclickstream\b|\bpurchase history\b|\border history\b|\busage (?:data|information)\b|\bhow you (?:use|interact)\b|\bpages? (?:you )?(?:view|visit)\w*\b`) },
  { cat: 'user.content.message', re: L(String.raw`\bcontents? of (?:your )?(?:messages|communications|emails)\b|\bmessages? you (?:send|write|post)\b`) },
  { cat: 'user.vehicle_id', re: L(String.raw`\blicen[sc]e plates?\b|\bvehicle identification numbers?\b`) },
  { cat: 'user.contact.url', re: L(String.raw`\bsocial media (?:profiles?|handles?|accounts?)\b|\bprofile url\b`) },
];

/** Words that make a whole sentence stand for several categories at once: vague on purpose. */
const UMBRELLAS: { re: RegExp; cats: string[] }[] = [
  { re: L(String.raw`\bonline identifiers?\b`), cats: ['user.device', 'user.unique_id'] },
  { re: L(String.raw`(?<!device |advertising |mobile |hardware |unique |online |tracking )\b(?:personal )?identifiers\b|\bidentifying information\b`), cats: ['user.name', 'user.contact', 'user.unique_id', 'user.device'] },
];
/** "We collect personal information" with nothing more specific: a statement that covers everything and says nothing. */
const GENERIC = L(String.raw`\b(?:collect|gather|obtain|receive|process|use)\b[^.:]{0,40}\b(?:personal (?:information|data)|information (?:about|that identifies) you)\b`);

const NEGATE_USE = L(String.raw`\b(?:do|does|will|did|would|shall)(?: not|n't)(?: currently)? (?:use|employ|deploy|set)\b|\bno (?:cookies|tracking)\b`);
const NEGATION = L(String.raw`\b(?:do|does|will|did|would|shall)(?: not|n't)(?: knowingly| intentionally| ever| currently)? (?:collect|gather|obtain|store|track|record|ask for|request|receive)\b|\bnever (?:knowingly )?(?:collect|gather|obtain|store|track|record|ask for|request|receive)\b|\b(?:dont|don't) (?:collect|gather|obtain|store|track|record|ask for)\b|\bno (?:\w+ ){0,3}(?:is|are) (?:collected|gathered|stored|recorded)\b|\bnot (?:be )?(?:collected|gathered|stored)\b`);
const HEDGE = L(String.raw`\b(?:may|might|could|from time to time|occasionally|sometimes|possibly|potentially)\b(?:\s+\w+){0,3}?\s+(?:collect|receive|obtain|gather|use|process|store|learn|infer|log|record|capture|track|ask)`);

export const PURPOSES: { id: string; re: RegExp }[] = [
  { id: 'provide_service', re: L(String.raw`\b(?:provide|operate|deliver|maintain|run) (?:and \w+ )?(?:our |the )?(?:services?|app|site|website|platform)\b|\bto provide\b|\bfulfil+ (?:your )?orders?\b`) },
  { id: 'analytics', re: L(String.raw`\banalytics\b|\banaly[sz]e (?:how|usage)\b|\bunderstand how (?:you|people)\b`) },
  { id: 'advertising', re: L(String.raw`\badvertis\w+\b|\bmarketing\b|\bpromotional\b|\bpersonali[sz]ed ads\b`) },
  { id: 'security_fraud', re: L(String.raw`\bfraud\b|\bsecurity\b|\babuse\b|\bprevent\b.*\bmisuse\b`) },
  { id: 'legal', re: L(String.raw`\blegal obligations?\b|\bcomply with\b|\blaw enforcement\b|\bapplicable law\b`) },
  { id: 'research', re: L(String.raw`\bresearch\b|\bimprove (?:our )?(?:services?|products?|app)\b`) },
  { id: 'communications', re: L(String.raw`\bcommunicate with you\b|\bsend you (?:emails?|messages|notifications|updates)\b|\bcustomer support\b|\brespond to\b`) },
  { id: 'personalisation', re: L(String.raw`\bpersonali[sz]\w+\b|\btailor\b`) },
];

const clip = (s: string) => (s.length > 320 ? s.slice(0, 317) + '...' : s);
const RANK: Record<Status, number> = { disclosed: 2, vague: 1, not_collected: 0 };

/** Turn a notice into a draft policy. Deterministic: the same text always gives the same draft. */
export function draftPolicy(text: string): Policy {
  const sentences = splitSentences(text);
  const lines = new Map<string, PolicyLine>();
  const purposes = new Map<string, PolicyPurpose>();
  const put = (category: string, status: Status, s: Sentence) => {
    const cur = lines.get(category);
    // An explicit "we do not collect" always shows; otherwise the clearer disclosure wins over a vaguer one.
    if (cur && cur.status !== 'not_collected' && status !== 'not_collected' && RANK[cur.status] >= RANK[status]) return;
    if (cur && cur.status === 'not_collected' && status !== 'not_collected') return;
    lines.set(category, { category, status, sentence: s.id, quote: clip(s.text), source: 'notice' });
  };
  for (const s of sentences) {
    for (const p of PURPOSES) if (p.re.test(s.text) && !purposes.has(p.id)) purposes.set(p.id, { purpose: p.id, sentence: s.id });
    const clauses = s.text.split(/\b(?:but|however|although|while|whereas)\b|;/i);
    for (const clause of clauses) {
      const negation = NEGATION.test(clause);
      const negateUse = !negation && NEGATE_USE.test(clause);
      const negated = negation;
      const hedged = !negated && HEDGE.test(clause);
      const hits = PHRASES.filter((p) => p.re.test(clause)).map((p) => p);
      const drop = new Set(hits.flatMap((h) => h.suppresses ?? []));
      let any = false;
      for (const h of hits) {
        if (drop.has(h.cat)) continue;
        any = true;
        put(h.cat, negated || (negateUse && h.tracking) ? 'not_collected' : negateUse ? 'disclosed' : hedged ? 'vague' : 'disclosed', s);
      }
      if (negated) continue;
      for (const u of UMBRELLAS) if (u.re.test(clause)) { any = true; for (const c of u.cats) put(c, 'vague', s); }
      if (!any && GENERIC.test(clause)) put('user', 'vague', s);
    }
  }
  return finishPolicy({ ...emptyPolicy(), categories: [...lines.values()], purposes: [...purposes.values()], sentences });
}

/** Fill the derived fields and put the lines in a stable order. */
export function finishPolicy(p: Policy): Policy {
  const categories = [...p.categories].sort((a, b) => a.category.localeCompare(b.category));
  const sensitive = categories
    .filter((l) => l.status !== 'not_collected' && BY_ID.has(l.category) && (getCategory(l.category).cpraSensitive || getCategory(l.category).gdpr9))
    .map((l) => l.category);
  return { ...p, categories, sensitive };
}

// ---------- yaml ----------

export function policyToYaml(p: Policy): string {
  const f = finishPolicy(p);
  return stringify({
    tool: f.tool, version: f.version, taxonomy: 'fideslang-compatible',
    categories: f.categories.map((l) => ({ category: l.category, status: l.status, ...(l.sentence ? { sentence: l.sentence } : {}), ...(l.quote ? { quote: l.quote } : {}), ...(l.source ? { source: l.source } : {}) })),
    purposes: f.purposes.map((u) => ({ purpose: u.purpose, ...(u.sentence ? { sentence: u.sentence } : {}) })),
    sensitive: f.sensitive,
    sentences: f.sentences.map((s) => ({ id: s.id, paragraph: s.paragraph, text: s.text })),
  }, { lineWidth: 0 });
}

export function policyFromYaml(text: string): Policy {
  const d = parse(text) as Record<string, unknown> | null;
  if (!d || d.tool !== 'privacydiff') throw new Error('not a policy.yml written by this tool');
  const major = String(d.version ?? '').split('.')[0];
  if (major !== POLICY_VERSION.split('.')[0]) throw new Error(`policy.yml is pinned to version ${String(d.version)}, this is ${POLICY_VERSION}`);
  const cats = (Array.isArray(d.categories) ? d.categories : []) as Record<string, unknown>[];
  const categories: PolicyLine[] = cats.map((c) => {
    const category = String(c.category), status = String(c.status) as Status;
    if (!isCategory(category)) throw new Error(`unknown category ${category}`);
    if (!['disclosed', 'vague', 'not_collected'].includes(status)) throw new Error(`unknown status ${status} for ${category}`);
    return { category, status, ...(c.sentence ? { sentence: String(c.sentence) } : {}), ...(c.quote ? { quote: String(c.quote) } : {}), ...(c.source ? { source: String(c.source) as LineSource } : {}) };
  });
  const purposes = ((Array.isArray(d.purposes) ? d.purposes : []) as Record<string, unknown>[]).map((u) => ({ purpose: String(u.purpose), ...(u.sentence ? { sentence: String(u.sentence) } : {}) }));
  const sentences = ((Array.isArray(d.sentences) ? d.sentences : []) as Record<string, unknown>[]).map((s) => ({ id: String(s.id), paragraph: Number(s.paragraph ?? 1), text: String(s.text) }));
  return finishPolicy({ tool: 'privacydiff', version: String(d.version), categories, purposes, sensitive: [], sentences });
}

// ---------- imports ----------

export interface ImportResult { policy: Policy; /** Ids or names in the file that this taxonomy does not have. */ unrecognised: string[] }

function walk(x: unknown, visit: (key: string, value: unknown) => void) {
  if (Array.isArray(x)) { for (const v of x) walk(v, visit); return; }
  if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { visit(k, v); walk(v, visit); }
}

/** Fides system or dataset YAML: every data_categories list, and data_use as purposes. */
export function importFides(text: string): ImportResult {
  const doc = parse(text);
  const found = new Set<string>(), unrecognised = new Set<string>(), uses = new Set<string>();
  walk(doc, (k, v) => {
    if (k === 'data_categories' && Array.isArray(v)) for (const id of v) (isCategory(String(id)) ? found : unrecognised).add(String(id));
    if (k === 'data_use' && typeof v === 'string') uses.add(v);
  });
  return {
    policy: finishPolicy({ ...emptyPolicy(), categories: [...found].map((category) => ({ category, status: 'disclosed' as const, source: 'fides' as const })), purposes: [...uses].map((purpose) => ({ purpose })) }),
    unrecognised: [...unrecognised].sort(),
  };
}

/** DPV personal data class names (local part) → this taxonomy. */
export const DPV_MAP: Record<string, string> = {
  emailaddress: 'user.contact.email', email: 'user.contact.email', telephonenumber: 'user.contact.phone_number', phonenumber: 'user.contact.phone_number',
  name: 'user.name', fullname: 'user.name', firstname: 'user.name', lastname: 'user.name', givenname: 'user.name', familyname: 'user.name',
  homeaddress: 'user.contact.address.street', address: 'user.contact.address', postaladdress: 'user.contact.address.street', postalcode: 'user.contact.address.postal_code', zipcode: 'user.contact.address.postal_code',
  location: 'user.location', preciselocation: 'user.location.precise', geolocation: 'user.location', approximatelocation: 'user.location.imprecise', coarselocation: 'user.location.imprecise',
  ipaddress: 'user.device.ip_address', deviceidentifier: 'user.device.device_id', cookie: 'user.device.cookie_id', onlineidentifier: 'user.device',
  useraccountidentifier: 'user.unique_id', uniqueidentifier: 'user.unique_id', useridentifier: 'user.unique_id', accountidentifier: 'user.unique_id',
  socialsecuritynumber: 'user.government_id.national_identification_number', nationalidentificationnumber: 'user.government_id.national_identification_number',
  passportnumber: 'user.government_id.passport_number', driverlicensenumber: 'user.government_id.drivers_license_number', driverslicensenumber: 'user.government_id.drivers_license_number',
  creditcardnumber: 'user.financial', paymentcard: 'user.financial', bankaccount: 'user.financial.bank_account', bankaccountnumber: 'user.financial.bank_account',
  dateofbirth: 'user.demographic.date_of_birth', birthdate: 'user.demographic.date_of_birth', age: 'user.demographic.age_range', gender: 'user.demographic.gender', sex: 'user.demographic.gender',
  racialorethnicorigin: 'user.demographic.race_ethnicity', ethnicorigin: 'user.demographic.race_ethnicity', racialorigin: 'user.demographic.race_ethnicity',
  sexualorientation: 'user.sexual_orientation', religiousbelief: 'user.religious_belief', religion: 'user.religious_belief', politicalopinion: 'user.political_opinion',
  tradeunionmembership: 'user.union_membership', healthrecord: 'user.health_and_medical', healthdata: 'user.health_and_medical', medicalhistory: 'user.health_and_medical', health: 'user.health_and_medical',
  biometric: 'user.biometric', biometricdata: 'user.biometric', genetic: 'user.genetic', geneticdata: 'user.genetic', photograph: 'user.image', photo: 'user.image',
  occupation: 'user.workplace', employer: 'user.workplace', browsinghistory: 'user.behavior', purchasehistory: 'user.behavior', childrendata: 'user.childrens', childdata: 'user.childrens',
};

/** A minimal DPV JSON-LD reader: any @id or string like dpv-pd:EmailAddress or https://w3id.org/dpv/pd#EmailAddress. */
export function importDpv(text: string): ImportResult {
  const doc = JSON.parse(text);
  const found = new Set<string>(), unrecognised = new Set<string>(), purposes = new Set<string>();
  const re = /(?:dpv(?:-pd)?:|https?:\/\/w3id\.org\/dpv(?:\/pd)?#)([A-Za-z0-9]+)/;
  const see = (s: string) => {
    const m = re.exec(s);
    if (!m) return;
    const local = m[1].toLowerCase();
    if (/purpose$/.test(local) || /^(service|analytics|marketing|advertising|research|security)/.test(local)) { purposes.add(local); return; }
    if (DPV_MAP[local]) found.add(DPV_MAP[local]);
    else if (!/^(personaldata|processing|collect|controller|processor|legalbasis|consent)/.test(local) && !/(handling|processing|process)$/.test(local)) unrecognised.add(m[1]);
  };
  walk(doc, (k, v) => { if (typeof v === 'string' && (k === '@id' || k === '@type' || /^dpv/.test(k) || k.includes(':'))) see(v); });
  walk(doc, (_k, v) => { if (typeof v === 'string') see(v); });
  return {
    policy: finishPolicy({ ...emptyPolicy(), categories: [...found].map((category) => ({ category, status: 'disclosed' as const, source: 'dpv' as const })), purposes: [...purposes].map((purpose) => ({ purpose })) }),
    unrecognised: [...unrecognised].sort(),
  };
}

/** Ticked categories: disclosed, no sentence behind them. */
export function policyFromTicked(ids: string[]): Policy {
  return finishPolicy({ ...emptyPolicy(), categories: ids.filter(isCategory).map((category) => ({ category, status: 'disclosed' as const, source: 'ticked' as const })) });
}

/** The tick list, grouped under the first CPRA category each belongs to. */
export function tickGroups(): { group: string; categories: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const c of CATEGORIES) {
    if (c.id === 'user') continue;
    const g = c.cpra[0] ?? 'Other';
    groups.set(g, [...(groups.get(g) ?? []), c.id]);
  }
  return [...groups.entries()].map(([group, categories]) => ({ group, categories }));
}
