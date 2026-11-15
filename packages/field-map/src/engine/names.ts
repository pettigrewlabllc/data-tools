/** Name similarity between a target path and a source path: tokens, a small synonym list, and prefixes. */

const SYNONYMS: string[][] = [
  ['email', 'mail', 'emailaddress', 'e-mail'],
  ['phone', 'tel', 'telephone', 'mobile', 'cell'],
  ['created', 'creation', 'inserted', 'createdat', 'datecreated', 'createdon', 'added'],
  ['updated', 'modified', 'changed', 'updatedat', 'lastmodified', 'updatedon'],
  ['price', 'cost', 'amount', 'rate'],
  ['total', 'amount', 'grandtotal', 'sum'],
  ['quantity', 'qty', 'count', 'units'],
  ['name', 'title', 'label', 'displayname', 'fullname'],
  ['id', 'identifier', 'key', 'uuid', 'guid'],
  ['zip', 'postal', 'postcode', 'zipcode', 'postalcode'],
  ['state', 'region', 'province'],
  ['country', 'nation', 'countrycode'],
  ['city', 'town', 'locality', 'place'],
  ['street', 'address', 'line1', 'addressline1', 'street1'],
  ['first', 'given', 'fname', 'firstname', 'givenname', 'forename'],
  ['last', 'family', 'surname', 'lname', 'lastname', 'familyname'],
  ['description', 'desc', 'summary', 'details', 'body'],
  ['url', 'link', 'href', 'uri', 'website'],
  ['latitude', 'lat'],
  ['longitude', 'lon', 'lng', 'long'],
  ['magnitude', 'mag'],
  ['sku', 'productcode', 'itemcode', 'partnumber'],
  ['time', 'timestamp', 'datetime', 'at', 'when', 'date'],
  ['customer', 'buyer', 'client', 'purchaser', 'user', 'account'],
  ['order', 'purchase', 'sale'],
  ['product', 'item', 'article'],
  ['status', 'state'],
  ['currency', 'curr', 'ccy'],
  ['tags', 'labels', 'keywords', 'categories'],
  ['author', 'creator', 'writer', 'by'],
  ['depth', 'elevation'],
  ['temperature', 'temp'],
  ['probability', 'chance', 'likelihood'],
  ['percent', 'pct', 'percentage'],
  ['precipitation', 'rain', 'rainfall'],
  ['citations', 'cited', 'citation'],
];

const STOP = new Set(['the', 'of', 'a', 'is', 'data', 'attributes', 'properties', 'fields', 'info']);
/** Unit suffixes say how a value is written, not what it is: `total_cents` is a total. */
const UNITS = new Set(['cents', 'minor', 'pct', 'percent', 'ms', 'usd', 'eur', 'gbp', 'kg', 'km', 'mph', 'utc', 'iso']);
/** Leaves that only say "the value of the parent": localized text (`category.en`) and `x.value`. */
const GENERIC_LEAF = new Set(['en', 'de', 'fr', 'es', 'se', 'no', 'it', 'nl', 'pt', 'ja', 'zh', 'value', 'val', 'text', 'raw', 'content', 'v']);

export function tokens(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t));
}

const flat = (s: string) => tokens(s).join('');
const meaning = (s: string) => { const t = tokens(s); const m = t.filter((x) => !UNITS.has(x)); return m.length ? m : t; };
/** `open_access` → "oa": a short leaf can be the other name's initials. */
let initialsCache = new Map<string, string>();
function initials(flatName: string): string {
  return initialsCache.get(flatName) ?? flatName;
}
export function registerInitials(name: string): void {
  const t = tokens(name);
  if (t.length >= 2) initialsCache.set(t.join(''), t.map((x) => x[0]).join(''));
  if (initialsCache.size > 5000) initialsCache = new Map();
}

const GROUP = new Map<string, Set<number>>();
SYNONYMS.forEach((g, i) => g.forEach((w) => { const s = GROUP.get(w) ?? new Set(); s.add(i); GROUP.set(w, s); }));

function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  if (b.length >= 2 && b.length <= 4 && a.length > b.length && initials(a) === b) return 0.8;
  if (a.length >= 2 && a.length <= 4 && b.length > a.length && initials(b) === a) return 0.8;
  const ga = GROUP.get(a), gb = GROUP.get(b);
  if (ga && gb && [...ga].some((g) => gb.has(g))) return 0.85;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.7;
  // A shared stem: publication / published, citation / cited.
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  if (k >= 5 && k >= 0.6 * Math.min(a.length, b.length)) return 0.7;
  if (a.length >= 3 && b.length >= 3) {
    if (a.endsWith('s') && a.slice(0, -1) === b) return 0.95;
    if (b.endsWith('s') && b.slice(0, -1) === a) return 0.95;
  }
  return 0;
}

/** Best one-to-one token matching, scored against the longer list (so extra tokens cost something). */
function listSim(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let total = 0;
  const used = new Set<number>();
  for (const x of a) {
    let best = 0, bi = -1;
    b.forEach((y, j) => { if (!used.has(j)) { const s = tokenSim(x, y); if (s > best) { best = s; bi = j; } } });
    if (bi >= 0) used.add(bi);
    total += best;
  }
  return total / Math.max(a.length, b.length);
}

/** One name, whole: `createdAt` vs `created_at` vs `created`. */
export function leafSim(a: string, b: string): number {
  registerInitials(a); registerInitials(b);
  const ta = meaning(a), tb = meaning(b);
  const fa = ta.join(''), fb = tb.join('');
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  const whole = tokenSim(fa, fb);
  return Math.max(whole, listSim(ta, tb));
}

/**
 * 0–1. The leaf names carry most of it; the rest of the path breaks ties between `customer.id` and `id`.
 */
export function nameSimilarity(target: string[], source: string[]): number {
  // `category.en` is the category; `probabilityOfPrecipitation.value` is the probability.
  const src = source.length > 1 && GENERIC_LEAF.has(source[source.length - 1].toLowerCase()) ? source.slice(0, -1) : source;
  const tLeaf = target[target.length - 1] ?? '', sLeaf = src[src.length - 1] ?? '';
  let leaf = leafSim(tLeaf, sLeaf);
  // An id inside a child object identifies the child: a record-level `id` is not `customer.id`.
  const idLike = (x: string) => /^(id|uuid|key)$/.test(flat(x));
  if (target.length === 1 && src.length > 1 && idLike(sLeaf) && idLike(tLeaf)) leaf *= 0.6;
  const full = listSim(target.flatMap(meaning), src.flatMap(meaning));
  return Math.min(1, Math.max(0.75 * leaf + 0.25 * full, 0.85 * full));
}

export const hasToken = (path: string[], ...words: string[]) => path.flatMap(tokens).some((t) => words.includes(t));
