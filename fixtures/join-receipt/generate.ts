/**
 * Builds the labelled join set from a fixed seed: pairs of CSV files plus the join a careful analyst
 * would choose (or "none"). Families include adversarial pairs built to defeat the scorer, so the
 * accuracy number can fail. Run: npm run fixtures
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { US_STATES, COUNTRIES } from '@data-tools/core';

const OUT = join(dirname(fileURLToPath(import.meta.url)), process.env.JR_PAIRS ?? 'pairs');

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(Number(process.env.JR_SEED ?? 20261109));
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: T[]) => xs[int(0, xs.length - 1)];
const shuffle = <T>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sample = <T>(xs: T[], n: number) => shuffle(xs).slice(0, n);

type Cell = string | number;
const csv = (header: string[], rows: Cell[][]) =>
  [header.join(','), ...rows.map((r) => r.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))].join('\n') + '\n';

// ---- base tables ---------------------------------------------------------------------------
const FIRST = ['ann', 'bo', 'cy', 'di', 'ed', 'flo', 'gus', 'hal', 'ivy', 'jo', 'kai', 'lu', 'max', 'ned', 'ola', 'pia'];
const LAST = ['lee', 'chu', 'diaz', 'fox', 'kim', 'ruiz', 'shah', 'wong', 'park', 'ng', 'cole', 'ito'];
const DOMAINS = ['example.com', 'mail.test', 'post.example.org'];
const people = Array.from({ length: 80 }, (_, i) => {
  const f = pick(FIRST), l = pick(LAST);
  return { email: `${f}.${l}${i}@${pick(DOMAINS)}`, name: `${f[0].toUpperCase()}${f.slice(1)} ${l[0].toUpperCase()}${l.slice(1)}`, state: pick(US_STATES).abbr! };
});
const counties = US_STATES.slice(0, 30).flatMap((s) =>
  Array.from({ length: int(4, 8) }, (_, k) => ({ fips: `${s.fips}${String(1 + 2 * k).padStart(3, '0')}`, state: s.abbr!, stateName: s.name, name: `${pick(['Oak', 'Elm', 'Pine', 'Bear', 'Clay', 'Lake', 'Rock'])} ${k}` })),
);
const products = Array.from({ length: 40 }, (_, i) => ({ sku: `SKU-${String(1000 + i * 7)}`, name: `${pick(['red', 'blue', 'tan'])} ${pick(['mug', 'cap', 'tee', 'bag'])}`, price: int(5, 90) }));

interface Label { left?: { table: string; column: string }; right?: { table: string; column: string }; none?: boolean; family: string; note: string }
const pairs: { id: string; left: string; right: string; label: Label }[] = [];
let n = 0;
function add(family: string, note: string, left: string, right: string, l?: [string, string], r?: [string, string]) {
  const id = `${String(++n).padStart(2, '0')}-${family}`;
  pairs.push({ id, left, right, label: l && r ? { left: { table: 'left', column: l[1] }, right: { table: 'right', column: r[1] }, family, note } : { none: true, family, note } });
}
const noise = () => int(1, 999);

// ---- clean (6) -------------------------------------------------------------------------------
{
  const ps = sample(people, 50);
  add('clean', 'email to email', csv(['email', 'name', 'signup_year'], ps.map((p) => [p.email, p.name, int(2015, 2024)])),
    csv(['email', 'orders', 'spend'], sample(ps, 40).map((p) => [p.email, int(1, 9), noise()])), ['left', 'email'], ['right', 'email']);
  add('clean', 'padded county fips both sides', csv(['fips', 'county', 'state'], counties.map((c) => [c.fips, c.name, c.state])),
    csv(['county_fips', 'rate'], sample(counties, 120).map((c) => [c.fips, (rnd() * 9).toFixed(1)])), ['left', 'fips'], ['right', 'county_fips']);
  add('clean', 'iso3 both sides', csv(['iso3', 'region'], COUNTRIES.map((c) => [c.iso3!, pick(['north', 'south', 'east', 'west'])])),
    csv(['country_code', 'gdp'], sample(COUNTRIES, 45).map((c) => [c.iso3!, noise()])), ['left', 'iso3'], ['right', 'country_code']);
  const custs = people.slice(0, 50).map((p, i) => ({ ...p, id: 100 + i }));
  add('clean', 'orders.customer_id to customers.id', csv(['id', 'email', 'name'], custs.map((c) => [c.id, c.email, c.name])),
    csv(['order_id', 'customer_id', 'total'], Array.from({ length: 150 }, (_, i) => [5000 + i, pick(custs).id, noise()])), ['left', 'id'], ['right', 'customer_id']);
  add('clean', 'sku to sku', csv(['sku', 'name', 'price'], products.map((p) => [p.sku, p.name, p.price])),
    csv(['sku', 'units', 'week'], Array.from({ length: 90 }, () => [pick(products).sku, int(1, 30), int(1, 52)])), ['left', 'sku'], ['right', 'sku']);
  add('clean', 'state abbr both sides', csv(['state', 'population'], US_STATES.map((s) => [s.abbr!, noise()])),
    csv(['st', 'gdp'], sample(US_STATES, 40).map((s) => [s.abbr!, noise()])), ['left', 'state'], ['right', 'st']);
}

// ---- unpadded FIPS (5) -----------------------------------------------------------------------
for (const [ln, rn] of [['fips', 'county_fips'], ['geoid', 'fips_code'], ['fips', 'fips'], ['area', 'loc_code'], ['county', 'county_id']]) {
  const cs = sample(counties, int(80, 150));
  add('unpadded', `${ln} (int) vs ${rn} (zero-padded)`, csv([ln, 'label', 'pop'], cs.map((c) => [Number(c.fips), c.name, noise()])),
    csv([rn, 'state', 'rate'], sample(cs, Math.floor(cs.length * 0.9)).map((c) => [c.fips, c.state, (rnd() * 9).toFixed(1)])), ['left', ln], ['right', rn]);
}

// ---- case and whitespace drift (5) -----------------------------------------------------------
for (let k = 0; k < 5; k++) {
  const ps = sample(people, 40);
  const mess = (s: string) => (k % 2 ? ` ${s.toUpperCase()} ` : s.replace(/^./, (c) => c.toUpperCase()));
  if (k < 3) add('case', 'email case/space drift', csv(['email', 'name'], ps.map((p) => [p.email, p.name])),
    csv(['contact_email', 'score'], sample(ps, 35).map((p) => [mess(p.email), int(1, 5)])), ['left', 'email'], ['right', 'contact_email']);
  else add('case', 'sku case/space drift', csv(['sku', 'price'], products.map((p) => [p.sku, p.price])),
    csv(['item', 'qty'], Array.from({ length: 60 }, () => [mess(pick(products).sku.toLowerCase()), int(1, 9)])), ['left', 'sku'], ['right', 'item']);
}

// ---- name vs code (6) ------------------------------------------------------------------------
{
  const st = US_STATES;
  add('crosswalk', 'state name vs abbr', csv(['state_name', 'pop'], st.map((s) => [s.name, noise()])), csv(['state', 'gdp'], sample(st, 45).map((s) => [s.abbr!, noise()])), ['left', 'state_name'], ['right', 'state']);
  add('crosswalk', 'abbr vs state fips (int)', csv(['state', 'pop'], st.map((s) => [s.abbr!, noise()])), csv(['state_fips', 'gdp'], sample(st, 45).map((s) => [Number(s.fips), noise()])), ['left', 'state'], ['right', 'state_fips']);
  add('crosswalk', 'lower-case name vs fips', csv(['state', 'pop'], st.map((s) => [s.name.toLowerCase(), noise()])), csv(['fips', 'gdp'], sample(st, 45).map((s) => [s.fips!, noise()])), ['left', 'state'], ['right', 'fips']);
  const cs = COUNTRIES;
  add('crosswalk', 'country name vs iso2', csv(['country', 'pop'], cs.map((c) => [c.name, noise()])), csv(['iso2', 'gdp'], sample(cs, 40).map((c) => [c.iso2!, noise()])), ['left', 'country'], ['right', 'iso2']);
  add('crosswalk', 'iso2 vs iso3', csv(['country_code', 'pop'], cs.map((c) => [c.iso2!, noise()])), csv(['iso3', 'gdp'], sample(cs, 40).map((c) => [c.iso3!, noise()])), ['left', 'country_code'], ['right', 'iso3']);
  add('crosswalk', 'iso3 vs country name', csv(['iso3', 'pop'], cs.map((c) => [c.iso3!, noise()])), csv(['nation', 'gdp'], sample(cs, 40).map((c) => [c.name, noise()])), ['left', 'iso3'], ['right', 'nation']);
}

// ---- adversarial decoys (6) ------------------------------------------------------------------
{
  const ps = sample(people, 40);
  add('decoy', 'row-number ids on both sides; real key is email', csv(['id', 'email', 'name'], ps.map((p, i) => [i + 1, p.email, p.name])),
    csv(['id', 'contact_email', 'score'], shuffle(ps).map((p, i) => [i + 1, p.email, int(1, 5)])), ['left', 'email'], ['right', 'contact_email']);
  const cs = sample(counties, 120);
  add('decoy', 'shared state column; real key is fips vs geoid', csv(['fips', 'state', 'pop'], cs.map((c) => [c.fips, c.state, noise()])),
    csv(['geoid', 'state', 'rate'], shuffle(cs).map((c) => [c.fips, c.state, noise()])), ['left', 'fips'], ['right', 'geoid']);
  add('decoy', 'shared year column; real key is sku', csv(['sku', 'year', 'price'], products.map((p) => [p.sku, int(2020, 2024), p.price])),
    csv(['product', 'year', 'units'], Array.from({ length: 80 }, () => [pick(products).sku, int(2020, 2024), int(1, 50)])), ['left', 'sku'], ['right', 'product']);
  add('decoy', 'overlapping int ids from different sequences; real key is email', csv(['user_id', 'email'], ps.map((p, i) => [200 + i, p.email])),
    csv(['ticket_id', 'requester', 'minutes'], Array.from({ length: 60 }, (_, i) => [210 + i, pick(ps).email, int(1, 90)])), ['left', 'email'], ['right', 'requester']);
  add('decoy', 'padded vs unpadded with unrelated names plus a shared name column', csv(['code', 'name', 'v'], cs.map((c) => [Number(c.fips), c.name, noise()])),
    csv(['region_key', 'name', 'w'], cs.map((c) => [c.fips, c.name, noise()])), ['left', 'code'], ['right', 'region_key']);
  add('decoy', 'shared low-cardinality status; real key is order id', csv(['order_id', 'status', 'total'], Array.from({ length: 60 }, (_, i) => [9000 + i, pick(['open', 'paid', 'shipped']), noise()])),
    csv(['order_ref', 'status', 'carrier'], Array.from({ length: 55 }, (_, i) => [9000 + i, pick(['open', 'paid', 'shipped']), pick(['ups', 'usps', 'dhl'])])), ['left', 'order_id'], ['right', 'order_ref']);
}

// ---- grain mismatch (4) ----------------------------------------------------------------------
for (let k = 0; k < 4; k++) {
  const cs = sample(counties, 40);
  const days = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'].slice(0, 2 + (k % 3));
  add('grain', `county dimension vs ${days.length} days of facts`, csv(['fips', 'county'], cs.map((c) => [c.fips, c.name])),
    csv(['date', 'county_fips', 'sales'], cs.flatMap((c) => days.map((d) => [d, c.fips, noise()]))), ['left', 'fips'], ['right', 'county_fips']);
}

// ---- partial drop with a planted pattern (4) -------------------------------------------------
for (let k = 0; k < 4; k++) {
  const cs = counties;
  const dropState = cs[int(0, cs.length - 1)].state;
  add('drops', `all ${dropState} rows missing on the right`, csv(['fips', 'state', 'county'], cs.map((c) => [c.fips, c.state, c.name])),
    csv(['fips', 'unemployment'], cs.filter((c) => c.state !== dropState).map((c) => [c.fips, (rnd() * 9).toFixed(1)])), ['left', 'fips'], ['right', 'fips']);
}

// ---- no reliable key (5) ---------------------------------------------------------------------
{
  add('none', 'disjoint email sets', csv(['email', 'name'], people.slice(0, 40).map((p) => [p.email, p.name])), csv(['email', 'score'], people.slice(40).map((p) => [p.email, int(1, 5)])));
  add('none', 'only a shared status category', csv(['a_id', 'status', 'v'], Array.from({ length: 40 }, (_, i) => [`A${i}`, pick(['open', 'closed', 'hold']), noise()])),
    csv(['b_id', 'status', 'w'], Array.from({ length: 40 }, (_, i) => [`B${i}`, pick(['open', 'closed', 'hold']), noise()])));
  add('none', 'only numeric measures overlap', csv(['x', 'y'], Array.from({ length: 40 }, () => [int(1, 50), int(1, 50)])), csv(['p', 'q'], Array.from({ length: 40 }, () => [int(1, 50), int(1, 50)])));
  add('none', 'different code systems', csv(['sku', 'price'], products.map((p) => [p.sku, p.price])), csv(['part_no', 'stock'], Array.from({ length: 40 }, (_, i) => [`PN${7000 + i}`, int(1, 99)])));
  add('none', 'counties vs countries', csv(['fips', 'pop'], counties.slice(0, 60).map((c) => [c.fips, noise()])), csv(['iso3', 'gdp'], COUNTRIES.map((c) => [c.iso3!, noise()])));
}

rmSync(OUT, { recursive: true, force: true });
for (const p of pairs) {
  const d = join(OUT, p.id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'left.csv'), p.left);
  writeFileSync(join(d, 'right.csv'), p.right);
  writeFileSync(join(d, 'label.json'), JSON.stringify(p.label, null, 2) + '\n');
}
console.log(`wrote ${pairs.length} labelled pairs to ${OUT}`);
