import { getCategory, type IdKind } from './taxonomy';
import { M } from './messages';

export interface ColumnInput {
  name: string;
  /** SQL type from DDL or DuckDB, e.g. VARCHAR, DOUBLE, DATE. May be empty. */
  type?: string;
  /** Distinct sample values when data is loaded. Omit for DDL-only mode. */
  samples?: string[];
  /** The table's name, used as a weak hint (a `name` column in `patients` is a person's name). */
  table?: string;
}

export interface Classification {
  /** A category id, or null when the column does not look like personal information. */
  category: string | null;
  confidence: number;
  kind: IdKind | null;
  reasons: string[];
  /** The next best guesses, so the person confirming can pick another. */
  alternatives: { category: string; confidence: number }[];
}

/** Below this a proposal is shown as "needs confirming". */
export const CONFIRM_BELOW = 0.75;

/** Split snake_case, camelCase, kebab-case and digits into lower-case words. */
export function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

interface NameRule {
  cat: string; re: RegExp; conf: number; not?: RegExp; boolOk?: boolean;
  /** A table name that makes this guess more likely, and by how much. */
  tableHint?: RegExp; hintBoost?: number;
  /** The guess is only made when the table name matches tableHint. */
  requireHint?: boolean;
  /** For a one-word column name: skip the guess in tables like these (a bare `state` in `orders`). */
  bareTableNot?: RegExp;
  /** Skip the guess in tables like these. */
  tableNot?: RegExp;
}

const PERSON_TABLE = /\b(users?|customers?|patients?|members?|people|person|employees?|contacts?|leads?|subscribers?|accounts?|profiles?|students?|clients?|applicants?|visitors?|donors?|riders?|drivers?)\b/;
const HEALTH_TABLE = /\b(patients?|clinic|clinical|visits?|health|medical|encounters?|appointments?|claims?|prescriptions?|diagnos\w*|labs?)\b/;
const NOT_PERSONAL = /\b(products?|items?|sku|logo|banner|icon|thumbnail|cover|hero|brands?|orders?|invoices?|shipments?|stores?|logs?)\b/;
const OPS_TABLE = /\b(orders?|jobs?|tasks?|tickets?|stores?|products?|logs?|events?|workflows?|machines?|shipments?|invoices?)\b/;

const RULES: NameRule[] = [
  { cat: 'user.contact.email', re: /\b(e ?mail|email addr(ess)?|mail)\b/, conf: 0.92 },
  { cat: 'user.contact.phone_number', re: /\b(phone|telephone|tel|mobile|cell|cellphone|msisdn|fax|ph (no|num|number)|contact (no|num|number))\b/, conf: 0.9 },
  { cat: 'user.name', re: /\b(full ?name|first ?name|last ?name|fname|lname|given name|family name|surname|forename|middle name|maiden name|legal name|customer name|patient name|member name|contact name|employee name)\b/, conf: 0.9 },
  { cat: 'user.name', re: /\b(name|display name|nickname|alias|nick)\b/, conf: 0.5, tableHint: PERSON_TABLE, hintBoost: 0.38,
    not: /\b(file|table|column|host|domain|service|server|cluster|queue|job|task|bucket|node|product|item|brand|company|business|org|organi[sz]ation|school|city|state|country|event|campaign|plan|team|group|role|category|type|app|device|model|city|street|path|class|sku|region|store|shop|vendor|supplier|project|tag|label|key|field|index|schema)\b/ },
  { cat: 'user.unique_id', re: /\b(user ?id|uid|customer ?id|cust ?id|member ?id|account ?id|acct ?id|person ?id|employee ?id|emp ?id|student ?id|contact ?id|profile ?id|subscriber ?id|client ?id|login|username|user name|handle|screen name)\b/, conf: 0.85,
    not: /\b(last|first|latest|recent|at|time|ts|timestamp|date|count|attempts?|failed)\b/ },
  { cat: 'user.contact.address.street', re: /\b(street|addr|address|address ?(line)? ?[12]|mailing addr(ess)?|home addr(ess)?|billing addr(ess)?|shipping addr(ess)?|apt|suite|house number)\b/, conf: 0.82,
    not: /\b(e ?mail|ip|mac|wallet|web|url|ipv4|ipv6|bitcoin|eth|btc|crypto|contract)\b/ },
  { cat: 'user.contact.address.city', re: /\b(city|town|municipality|locality)\b/, conf: 0.85 },
  { cat: 'user.contact.address.state', re: /\b(state|province|region|prefecture)\b/, conf: 0.55, bareTableNot: OPS_TABLE, not: /\b(status|machine|session|order|payment|workflow|ui|app|feature|job)\b/ },
  { cat: 'user.contact.address.postal_code', re: /\b(zip|zip ?code|postal ?code|post ?code|postcode|postal|pin ?code|zip ?[45])\b/, conf: 0.92 },
  { cat: 'user.contact.address.country', re: /\b(country|nation|nationality|country ?code)\b/, conf: 0.8 },
  { cat: 'user.contact.url', re: /\b(profile ?url|website|homepage|web ?site|linkedin|facebook|twitter|instagram|social (url|link|profile)|personal url)\b/, conf: 0.75 },
  { cat: 'user.location.precise', re: /\b(lat|latitude|lng|lon|longitude|gps|geo ?(lat|lng|lon|point|hash|location|position|coordinates?)|coords?|coordinates?|geolocation|geo|current location|last location)\b/, conf: 0.82 },
  { cat: 'user.location.precise', re: /\b(long|location|position|whereabouts|last seen at)\b/, conf: 0.5 },
  { cat: 'user.location.imprecise', re: /\b(approx|approximate|coarse|rounded|metro|dma|msa|area ?code)\b/, conf: 0.78 },
  { cat: 'user.device.ip_address', re: /\b(ip|ip ?addr(ess)?|ipv4|ipv6|client ip|remote addr|user ip|x forwarded for|ip ?v ?[46])\b/, conf: 0.92 },
  { cat: 'user.device.device_id', re: /\b(device ?id|idfa|gaid|aaid|imei|udid|advertising id|ad id|android id|serial ?(no|number)|mac addr(ess)?|device token|push token|fcm token|installation id|install id|idfv|device serial)\b/, conf: 0.9 },
  { cat: 'user.device.cookie_id', re: /\b(cookie|cookie ?id|visitor ?id|anonymous ?id|anon ?id|tracking ?id|distinct ?id|device fingerprint|browser fingerprint)\b/, conf: 0.82 },
  { cat: 'user.device.cookie_id', re: /\b(session ?id|sid)\b/, conf: 0.62 },
  { cat: 'user.vehicle_id', re: /\b(vin|license ?plate|plate ?(no|number)|vehicle ?(id|no)|number plate|registration (no|number))\b/, conf: 0.9 },
  { cat: 'user.credentials', re: /\b(password|passwd|pwd|pass ?hash|secret|api ?key|access ?token|auth ?token|refresh ?token|security answer|pin)\b/, conf: 0.8, not: /\b(reset|expires?|expiry|age|last|changed|updated|set|strength|policy|min|max|length|rules?|attempts?|count)\b/ },
  { cat: 'user.government_id.national_identification_number', re: /\b(ssn|social security( (no|num|number))?|sin|national ?id|nin|tax ?id|tin|itin|aadhaar|national insurance|nino|cpf|curp|ni number)\b/, conf: 0.93 },
  { cat: 'user.government_id.drivers_license_number', re: /\b(driver s? ?licen[sc]e|drivers? ?licen[sc]e|dl ?(no|num|number)|driving licen[sc]e|licen[sc]e ?(no|num|number)|dln)\b/, conf: 0.92 },
  { cat: 'user.government_id.passport_number', re: /\bpassport( (no|num|number))?\b/, conf: 0.92 },
  { cat: 'user.government_id', re: /\b(gov ?id|government ?id|state ?id|id ?card|identity document|photo ?id|id ?(no|number))\b/, conf: 0.75 },
  { cat: 'user.financial', re: /\b(credit ?card|debit ?card|card ?(no|num|number)|cc ?(num|number|no)|pan|card ?number|payment card|card ?last ?4|cvv|cvc|ccv|card expiry|card exp)\b/, conf: 0.92 },
  { cat: 'user.financial.bank_account', re: /\b(bank ?account|iban|routing ?(no|num|number)?|aba|sort code|swift|bic|account ?(no|num|number)|acct ?(no|num|number)|checking|savings account)\b/, conf: 0.9 },
  { cat: 'user.demographic.date_of_birth', re: /\b(dob|birth ?date|date of birth|birthday|born|bday|d o b|date ?born)\b/, conf: 0.93, not: /\b(place|country|city|state|order|weight|certificate|cert|child|kid)\b/ },
  { cat: 'user.demographic.age_range', re: /\b(birth ?year|birth|yob|year of birth|birth month|age ?range|age ?group|age ?band|age ?bracket|age)\b/, conf: 0.8, not: /\b(usage|average|avg|message|stage|image|page|manage|package|storage|coverage|account age|file|cache|session|token|min|max|data|index)\b/ },
  { cat: 'user.demographic.gender', re: /\b(gender|sex|pronouns?)\b/, conf: 0.85 },
  { cat: 'user.demographic.race_ethnicity', re: /\b(race|ethnicity|ethnic|ethnic origin|racial|hispanic|latino|skin ?tone)\b/, conf: 0.9 },
  { cat: 'user.sexual_orientation', re: /\b(sexual orientation|lgbtq|lgbt|sex life|sexuality)\b/, conf: 0.9 },
  { cat: 'user.sexual_orientation', re: /\borientation\b/, conf: 0.5 },
  { cat: 'user.religious_belief', re: /\b(religion|religious|faith|denomination|creed|church|religious ?belief)\b/, conf: 0.86 },
  { cat: 'user.political_opinion', re: /\b(political|party affiliation|party ?id|voting|voter|politics|political party)\b/, conf: 0.82 },
  { cat: 'user.political_opinion', re: /\b(party|vote)\b/, conf: 0.5 },
  { cat: 'user.union_membership', re: /\b(union ?(member|status|membership)|trade union|union)\b/, conf: 0.8 },
  { cat: 'user.health_and_medical.record_number', re: /\b(mrn|medical record( (no|num|number|id))?|chart ?(no|num|number)|patient ?(no|number|id)|health record( id)?)\b/, conf: 0.9 },
  { cat: 'user.health_and_medical.insurance_id', re: /\b(insurance|insurance ?id|policy ?(no|num|number)|beneficiary|medicare|medicaid|health plan|payer ?id|group ?(no|number))\b/, conf: 0.84, not: /\b(company|provider|carrier|type|name|plan)\b/ },
  { cat: 'user.health_and_medical', re: /\b(diagnosis|diagnoses|dx|icd ?(9|10)?|medical|medication|medications|rx|prescription|allerg(y|ies)|disease|symptoms?|treatment|therapy|illness|disability|pregnan(t|cy)|hiv|blood ?(type|pressure|glucose|sugar)|clinical|lab ?results?|patient notes?|chief complaint|immunization|vaccin(e|ation)|mental health|diabetes|cancer|health ?condition|medical ?condition)\b/, conf: 0.88 },
  { cat: 'user.health_and_medical', re: /\b(bmi|heart ?rate)\b/, conf: 0.8 },
  { cat: 'user.health_and_medical', re: /\b(condition|weight|health|procedure|height|cpt|notes?)\b/, conf: 0.45, tableHint: HEALTH_TABLE, hintBoost: 0.4, requireHint: true,
    not: /\b(product|item|package|shipping|order|box|parcel|net|gross|max|min|total|battery|file|data|system|check|score)\b/ },
  { cat: 'user.biometric', re: /\b(finger ?print|face ?(id|print|template|embedding|vector)|faceprint|voice ?print|iris|retina|retinal|biometric|palm ?print|gait|facial recognition)\b/, conf: 0.8,
    not: /\b(device|browser|client|canvas|hash|ssl|tls|cert|file|key|checksum)\b/ },
  { cat: 'user.genetic', re: /\b(genetic|genome|dna|genotype|snp|chromosome|allele|23andme)\b/, conf: 0.9 },
  { cat: 'user.image', re: /\b(photo|photograph|selfie|avatar|profile ?(pic|picture|image|photo)|headshot|portrait|face ?image|mugshot)\b/, conf: 0.78, not: NOT_PERSONAL, tableNot: /\b(products?|items?|brands?|stores?|catalog)\b/ },
  { cat: 'user.childrens', re: /\b(under ?13|under thirteen|is ?(child|minor|kid)|child ?(age|dob|name)|coppa|parental ?(consent|email)|parent ?(email|consent)|guardian ?(email|name|consent)?|age ?under|is under)\b/, conf: 0.88, boolOk: true },
  { cat: 'user.childrens', re: /\b(child|children|minor|kid|kids)\b/, conf: 0.5, boolOk: true, not: /\b(id|node|count|process|items?|nodes?|order|task|element|table|key|path|index|depth)\b/ },
  { cat: 'user.workplace', re: /\b(employer|job ?title|occupation|profession|salary|income|wage|work ?email|position title)\b/, conf: 0.76 },
  { cat: 'user.workplace', re: /\b(company|department|organi[sz]ation|org)\b/, conf: 0.42, tableHint: PERSON_TABLE, hintBoost: 0.2, not: /\b(id|count|code|key|name)\b/ },
  { cat: 'user.behavior', re: /\b(browsing ?history|search ?(history|query|queries|terms?)|click ?stream|purchase ?history|order ?history|watch ?history|viewing ?history|login ?history|visited ?pages)\b/, conf: 0.8 },
  { cat: 'user.behavior', re: /\b(page ?views?|referrer|user ?agent|ua string|app ?usage)\b/, conf: 0.7 },
  { cat: 'user.content.message', re: /\b(message ?(body|text|content)|email ?body|sms ?(body|text)|chat ?(message|text)|dm ?text|body ?text|comment ?text)\b/, conf: 0.62 },
];

// ---------- value checks ----------

const nonEmpty = (s: string[]) => s.map((v) => v.trim()).filter((v) => v !== '');
const mostly = (vals: string[], pred: (v: string) => boolean, share = 0.9) => vals.length > 0 && vals.filter(pred).length / vals.length >= share;

export function luhn(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}

const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const isIpv4 = (v: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(v) && v.split('.').every((o) => +o <= 255);
const isIpv6 = (v: string) => /^[0-9a-f:]{3,39}$/i.test(v) && (v.match(/:/g) ?? []).length >= 2 && /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i.test(v);
const isCard = (v: string) => { const d = v.replace(/[ -]/g, ''); return /^\d{13,19}$/.test(d) && /^[\d -]+$/.test(v) && luhn(d); };
const isSsn = (v: string) => /^(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}$/.test(v);
const isPhone = (v: string) => /^(\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}$/.test(v) || /^\+\d{8,15}$/.test(v) || /^\(\d{3}\) ?\d{3}-\d{4}$/.test(v);
const isZip = (v: string) => /^\d{5}(-\d{4})?$/.test(v);
const decimals = (v: string) => (/^-?\d+\.(\d+)$/.exec(v)?.[1].length ?? 0);
const isLat = (v: string) => /^-?\d+(\.\d+)?$/.test(v) && Math.abs(+v) <= 90;
const isLon = (v: string) => /^-?\d+(\.\d+)?$/.test(v) && Math.abs(+v) <= 180;

function birthYear(v: string): number | null {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(v) ?? /^\d{1,2}\/\d{1,2}\/(\d{4})$/.exec(v);
  return m ? +m[1] : null;
}
const GENDER = new Set(['m', 'f', 'male', 'female', 'man', 'woman', 'non-binary', 'nonbinary', 'nb', 'other', 'x', 'unknown', 'prefer not to say']);

interface Candidate { cat: string; conf: number; reasons: string[] }

function valueCandidates(vals: string[], nameHit: (cat: string) => boolean, tokens: string[]): Candidate[] {
  const out: Candidate[] = [];
  if (vals.length < 1) return out;
  const enough = vals.length >= 3;
  const hasLat = tokens.some((t) => ['lat', 'latitude'].includes(t));
  const hasLon = tokens.some((t) => ['lon', 'lng', 'long', 'longitude'].includes(t));
  if (mostly(vals, isEmail)) out.push({ cat: 'user.contact.email', conf: 0.97, reasons: [M.reasonValues('email addresses', share(vals, isEmail))] });
  if (enough && mostly(vals, isCard)) out.push({ cat: 'user.financial', conf: 0.96, reasons: [M.reasonValues('card numbers that pass the Luhn check', share(vals, isCard))] });
  if (enough && mostly(vals, isSsn)) out.push({ cat: 'user.government_id.national_identification_number', conf: 0.95, reasons: [M.reasonValues('the social security number pattern', share(vals, isSsn))] });
  if (mostly(vals, (v) => isIpv4(v) || isIpv6(v))) out.push({ cat: 'user.device.ip_address', conf: 0.97, reasons: [M.reasonValues('IP addresses', share(vals, (v) => isIpv4(v) || isIpv6(v)))] });
  if (enough && mostly(vals, isPhone)) out.push({ cat: 'user.contact.phone_number', conf: 0.88, reasons: [M.reasonValues('phone numbers', share(vals, isPhone))] });
  if (enough && mostly(vals, isZip)) out.push({ cat: 'user.contact.address.postal_code', conf: nameHit('user.contact.address.postal_code') ? 0.95 : 0.45, reasons: [M.reasonValues('5-digit ZIP codes', share(vals, isZip))] });
  if (enough && (hasLat || hasLon || nameHit('user.location.precise'))) {
    const inRange = mostly(vals, hasLon && !hasLat ? isLon : isLat);
    if (inRange) {
      const dec = vals.map(decimals).sort((a, b) => a - b);
      const p90 = dec[Math.floor(dec.length * 0.9)] ?? 0;
      if (p90 >= 3) out.push({ cat: 'user.location.precise', conf: 0.93, reasons: [M.reasonDecimals(p90, true)] });
      else if (p90 >= 1 || vals.every((v) => /^-?\d+$/.test(v))) out.push({ cat: 'user.location.imprecise', conf: 0.85, reasons: [M.reasonDecimals(p90, false)] });
    }
  }
  const years = vals.map(birthYear);
  if (enough && years.every((y) => y !== null)) {
    const ys = years as number[];
    const inRange = ys.filter((y) => y >= 1915 && y <= 2012).length / ys.length;
    const span = Math.max(...ys) - Math.min(...ys);
    if (inRange >= 0.9 && span >= 25) out.push({ cat: 'user.demographic.date_of_birth', conf: nameHit('user.demographic.date_of_birth') ? 0.96 : 0.5, reasons: [M.reasonBirthDates()] });
  }
  if (enough && mostly(vals.map((v) => v.toLowerCase()), (v) => GENDER.has(v))) {
    out.push({ cat: 'user.demographic.gender', conf: nameHit('user.demographic.gender') ? 0.93 : 0.72, reasons: [M.reasonValues('gender labels', 1)] });
  }
  return out;
}

const share = (vals: string[], pred: (v: string) => boolean) => vals.filter(pred).length / vals.length;

// ---------- the classifier ----------

export function classifyPersonal(col: ColumnInput): Classification {
  const tokens = tokenize(col.name);
  const norm = tokens.join(' ');
  const tableNorm = col.table ? tokenize(col.table).join(' ') : '';
  const type = (col.type ?? '').toUpperCase();
  const vals = col.samples ? nonEmpty(col.samples) : [];
  const isBool = type === 'BOOLEAN' || type === 'BOOL' || (vals.length > 0 && mostly(vals, (v) => /^(true|false|t|f|y|n|yes|no|0|1)$/i.test(v)));
  const cands = new Map<string, Candidate>();
  const add = (cand: Candidate) => {
    const cur = cands.get(cand.cat);
    if (!cur) cands.set(cand.cat, { ...cand, reasons: [...cand.reasons] });
    else if (cand.conf >= cur.conf) cands.set(cand.cat, { cat: cand.cat, conf: cand.conf + (1 - cand.conf) * 0.4 * (cur.conf > 0.5 ? 1 : 0), reasons: [...cur.reasons, ...cand.reasons] });
    else cur.reasons.push(...cand.reasons);
  };

  const nameHits = new Set<string>();
  for (const r of RULES) {
    const m = r.re.exec(norm);
    if (!m) continue;
    if (r.not && r.not.test(norm)) continue;
    if (isBool && !r.boolOk && !getCategory(r.cat).gdpr9) continue;
    if (r.requireHint && !r.tableHint!.test(tableNorm)) continue;
    if (r.bareTableNot && tokens.length === 1 && r.bareTableNot.test(tableNorm)) continue;
    if (r.tableNot && r.tableNot.test(tableNorm)) continue;
    if (r.tableHint && !r.requireHint && NOT_PERSONAL.test(tableNorm)) continue;
    let conf = r.conf;
    if (r.tableHint && r.tableHint.test(tableNorm)) conf = Math.min(0.9, conf + (r.hintBoost ?? 0.2));
    const reasons = [M.reasonName(m[0].trim())];
    if (r.tableHint && r.tableHint.test(tableNorm)) reasons.push(M.reasonTable(col.table!));
    nameHits.add(r.cat);
    add({ cat: r.cat, conf, reasons });
  }

  // Modifiers turn "email" into "email_opt_in": the column is about the data, not the data itself.
  const strong = /\b(opt|optin|optout|consent|verified|verify|flag|count|cnt|total|enabled|valid|bounced|sent|score|preference|pref|prefs)\b/.test(norm);
  const weak = /\b(status|domain|format|length|len|since|at|on|updated|created|changed|expires?)\b/.test(norm);
  if (strong || weak) {
    for (const cand of cands.values()) {
      if (cand.cat === 'user.childrens') continue;
      if (!strong && getCategory(cand.cat).gdpr9) continue;
      cand.conf *= strong ? 0.25 : 0.55;
      cand.reasons.push(M.reasonModifier());
    }
  }
  // A word like "approx" or "rounded" says the coordinates were reduced, so the precise guess steps aside.
  if (cands.has('user.location.imprecise') && cands.has('user.location.precise')) {
    const imp = cands.get('user.location.imprecise')!;
    if (/\b(approx|approximate|coarse|rounded)\b/.test(norm)) { imp.conf += 0.1; cands.delete('user.location.precise'); }
  }

  for (const v of valueCandidates(vals, (c) => nameHits.has(c), tokens)) {
    if (isBool && v.cat !== 'user.childrens') continue;
    const had = cands.get(v.cat);
    if (had && had.conf < v.conf) {
      // Name and values agree: more sure than either alone.
      cands.set(v.cat, { cat: v.cat, conf: Math.min(0.99, v.conf + (1 - v.conf) * 0.2), reasons: [...had.reasons, ...v.reasons] });
    } else if (had) had.reasons.push(...v.reasons);
    else add(v);
  }

  // DDL type: a date for a birth-date name, a number for coordinates.
  if (type) {
    const dob = cands.get('user.demographic.date_of_birth');
    if (dob && (type === 'DATE' || type.startsWith('TIMESTAMP'))) { dob.conf = Math.min(0.97, dob.conf + 0.03); dob.reasons.push(M.reasonType(type)); }
    if (dob && /^(BOOLEAN|BOOL)$/.test(type)) cands.delete('user.demographic.date_of_birth');
    const loc = cands.get('user.location.precise');
    if (loc && /^(DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC)/.test(type)) { loc.conf = Math.min(0.9, loc.conf + 0.04); loc.reasons.push(M.reasonType(type)); }
    if (loc && /^(DATE|TIMESTAMP|BOOLEAN|BOOL)/.test(type)) cands.delete('user.location.precise');
    // Value-derived precision overrides the name's default when data is present.
  }
  // Where a value check found precision, it wins over the name-only guess.
  const vPrec = valueCandidates(vals, (c) => nameHits.has(c), tokens).find((x) => x.cat.startsWith('user.location.'));
  if (vPrec) for (const k of ['user.location.precise', 'user.location.imprecise']) if (k !== vPrec.cat) cands.delete(k);

  const ranked = [...cands.values()].map((x) => ({ ...x, conf: Math.round(Math.min(0.99, x.conf) * 100) / 100 })).sort((a, b) => b.conf - a.conf || a.cat.localeCompare(b.cat));
  const top = ranked[0];
  if (!top || top.conf < 0.3) return { category: null, confidence: top ? top.conf : 0, kind: null, reasons: [], alternatives: ranked.slice(0, 2).map((x) => ({ category: x.cat, confidence: x.conf })) };
  return {
    category: top.cat, confidence: top.conf, kind: getCategory(top.cat).kind, reasons: [...new Set(top.reasons)],
    alternatives: ranked.slice(1, 3).map((x) => ({ category: x.cat, confidence: x.conf })),
  };
}

export const needsConfirming = (c: Classification) => c.category !== null && c.confidence < CONFIRM_BELOW;
