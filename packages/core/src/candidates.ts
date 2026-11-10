import type { Db } from './db';
import type { KeyPair, KeyRef, Transform, CodeKind, CrosswalkTable } from './grammar';
import type { ColumnProfile, TableProfile } from './profile';
import { formatFamily, joinable, type FormatClass } from './formats';
import { ident } from './sql/quote';
import { keyExpr, compositeKeyExpr, crosswalkCtes, withClause } from './sql/emit';
import { nameSimilarity, scoreCandidate, type Features } from './score';

export interface JoinCandidate { left: KeyRef; right: KeyRef; also?: KeyPair[]; features: Features; score: number; reason: string }
export interface PairResult { left: string; right: string; best: JoinCandidate[]; reliable: boolean }
export interface CandidateResult { pairs: PairResult[] }

const CODE: Partial<Record<FormatClass, [CrosswalkTable, CodeKind]>> = {
  us_state_name: ['us_state', 'name'], us_state_abbr: ['us_state', 'abbr'], us_state_fips: ['us_state', 'fips'],
  country_name: ['country', 'name'], iso2: ['country', 'iso2'], iso3: ['country', 'iso3'],
};

const digitish = (c: ColumnProfile) => c.samples.length > 0 && c.samples.filter((v) => /^\d+$/.test(v.trim())).length / c.samples.length >= 0.9;
const textish = (c: ColumnProfile) => !/INT|DOUBLE|DECIMAL|FLOAT|DATE|TIME|BOOL/.test(c.type);

/** The normalisation chains worth trying for a column pair, cheapest first. Always includes no change. */
export function normalisationChains(l: ColumnProfile, r: ColumnProfile): { left: Transform[]; right: Transform[] }[] {
  const out: { left: Transform[]; right: Transform[] }[] = [{ left: [], right: [] }];
  if (digitish(l) && digitish(r)) {
    const w = Math.max(l.maxLen, r.maxLen);
    const padL = l.minLen < w, padR = r.minLen < w;
    if ((padL || padR) && w <= 20) {
      out.push({ left: padL ? [{ op: 'lpad', width: w, fill: '0' }] : [], right: padR ? [{ op: 'lpad', width: w, fill: '0' }] : [] });
    }
  }
  if (textish(l) && textish(r) && !digitish(l)) out.push({ left: [{ op: 'trim' }, { op: 'lower' }], right: [{ op: 'trim' }, { op: 'lower' }] });
  const cl = CODE[l.format], cr = CODE[r.format];
  if (cl && cr && cl[0] === cr[0] && cl[1] !== cr[1]) {
    const target = cr[1];
    const right: Transform[] = target === 'fips' ? [{ op: 'lpad', width: 2, fill: '0' }] : target === 'name' ? [{ op: 'trim' }, { op: 'upper' }] : [{ op: 'trim' }, { op: 'upper' }];
    const left: Transform[] = [{ op: 'crosswalk', table: cl[0], from: cl[1], to: target }];
    if (target !== 'fips') left.push({ op: 'upper' });
    out.push({ left, right });
  }
  if (formatFamily(l.format) === 'temporal' && formatFamily(r.format) === 'temporal' && l.format !== r.format) {
    out.push({ left: [{ op: 'date_trunc', unit: 'day' }], right: [{ op: 'date_trunc', unit: 'day' }] });
  }
  return out;
}

/** Cheap filter before any query: is this column pair worth testing at all? */
function plausible(l: ColumnProfile, r: ColumnProfile, sim: number): boolean {
  if (!joinable(l.format) || !joinable(r.format)) return false;
  if (Math.min(l.distinct, r.distinct) < 3 && sim < 1) return false;
  const fl = formatFamily(l.format), fr = formatFamily(r.format);
  if (fl === fr && fl !== 'text') return true;
  if (sim >= 0.5) return true;
  if (digitish(l) && digitish(r) && Math.abs(l.maxLen - r.maxLen) <= 2) return true;
  return false;
}

async function containment(db: Db, left: KeyRef, right: KeyRef, also: KeyPair[] = []): Promise<{ nl: number; nr: number; both: number }> {
  const lrefs = [left, ...also.map((p) => p.left)], rrefs = [right, ...also.map((p) => p.right)];
  const lk = compositeKeyExpr(lrefs, 'l'), rk = compositeKeyExpr(rrefs, 'r');
  const sql = `${withClause([
    ...crosswalkCtes([...lrefs, ...rrefs]),
    `lk AS (SELECT DISTINCT ${lk} AS k FROM ${ident(left.table)} AS l WHERE ${lk} IS NOT NULL)`,
    `rk AS (SELECT DISTINCT ${rk} AS k FROM ${ident(right.table)} AS r WHERE ${rk} IS NOT NULL)`,
  ])}SELECT (SELECT count(*) FROM lk) AS nl, (SELECT count(*) FROM rk) AS nr, (SELECT count(*) FROM lk JOIN rk USING (k)) AS both`;
  const [row] = await db.query(sql);
  return { nl: Number(row.nl), nr: Number(row.nr), both: Number(row.both) };
}

/** Uniqueness of a transformed key (a padded code can stop being unique if two raw values collapse). */
async function uniqueAfter(db: Db, ref: KeyRef, rows: number, nulls: number): Promise<boolean> {
  if (!ref.transforms.length) return false;
  const k = keyExpr(ref, 't');
  const [r] = await db.query(`${withClause(crosswalkCtes([ref]))}SELECT count(DISTINCT ${k}) AS d, count(${k}) AS n FROM ${ident(ref.table)} AS t`);
  return Number(r.d) === Number(r.n) && Number(r.n) === rows - nulls;
}

export async function scorePair(db: Db, lp: TableProfile, rp: TableProfile, lc: ColumnProfile, rc: ColumnProfile, chain: { left: Transform[]; right: Transform[] }): Promise<JoinCandidate> {
  const left: KeyRef = { table: lp.table, column: lc.name, transforms: chain.left };
  const right: KeyRef = { table: rp.table, column: rc.name, transforms: chain.right };
  const c = await containment(db, left, right);
  const features: Features = {
    containLeft: c.nl ? c.both / c.nl : 0,
    containRight: c.nr ? c.both / c.nr : 0,
    overlap: c.both,
    leftUnique: lc.unique || (await uniqueAfter(db, left, lp.rows, lc.nulls)),
    rightUnique: rc.unique || (await uniqueAfter(db, right, rp.rows, rc.nulls)),
    formatMatch: formatFamily(lc.format) === formatFamily(rc.format),
    nameSim: nameSimilarity(lc.name, rc.name, lp.table, rp.table),
    minDistinct: Math.min(lc.distinct, rc.distinct),
    bothRowNumbers: lc.rowNumber && rc.rowNumber,
  };
  const { score, reason } = scoreCandidate(features, left, right);
  return { left, right, features, score, reason };
}

export const RELIABLE_SCORE = 50;
export const RELIABLE_CONTAINMENT = 0.6;

export async function candidatesForPair(db: Db, lp: TableProfile, rp: TableProfile): Promise<PairResult> {
  const found: JoinCandidate[] = [];
  for (const lc of lp.columns) for (const rc of rp.columns) {
    const sim = nameSimilarity(lc.name, rc.name, lp.table, rp.table);
    if (!plausible(lc, rc, sim)) continue;
    let best: JoinCandidate | null = null;
    for (const chain of normalisationChains(lc, rc)) {
      const cand = await scorePair(db, lp, rp, lc, rc, chain);
      if (cand.features.overlap === 0) continue;
      if (!best || cand.score > best.score) best = cand;
    }
    if (best) found.push(best);
  }
  found.sort((a, b) => b.score - a.score || a.left.column.localeCompare(b.left.column) || a.right.column.localeCompare(b.right.column));
  dropDominatedLookups(found);
  const composite = await compositeCandidate(db, lp, rp, found);
  if (composite) found.unshift(composite);
  const top = found[0];
  const reliable = !!top && top.score >= RELIABLE_SCORE && Math.max(top.features.containLeft, top.features.containRight) >= RELIABLE_CONTAINMENT;
  return { left: lp.table, right: rp.table, best: found.slice(0, 3), reliable };
}

const usesLookup = (c: { left: KeyRef; right: KeyRef; also?: KeyPair[] }) =>
  [c.left, c.right, ...(c.also ?? []).flatMap((p) => [p.left, p.right])].some((k) => k.transforms.some((t) => t.op === 'crosswalk'));

/**
 * A lookup (state abbr → FIPS) only translates information a file may already have. If another key on the
 * same pair matches at least as many values without a lookup and is just as unique, the lookup key goes.
 * Found on real Census files: STATE (AL) via a lookup outscored STATEFP (01) on name similarity alone.
 */
export function dropDominatedLookups(found: JoinCandidate[]): void {
  for (let i = found.length - 1; i >= 0; i--) {
    const a = found[i];
    if (!usesLookup(a)) continue;
    const better = found.some((b) => b !== a && !usesLookup(b) && b.features.overlap >= a.features.overlap
      && (b.features.leftUnique || !a.features.leftUnique) && (b.features.rightUnique || !a.features.rightUnique));
    if (better) found.splice(i, 1);
  }
}

/** Is a several-column key, after its cleanup, one row per key with no missing parts? */
async function compositeUnique(db: Db, p: TableProfile, refs: KeyRef[]): Promise<boolean> {
  const k = compositeKeyExpr(refs, 't');
  const [r] = await db.query(`${withClause(crosswalkCtes(refs))}SELECT count(DISTINCT ${k}) AS d, count(${k}) AS n FROM ${ident(p.table)} AS t`);
  return Number(r.d) === Number(r.n) && Number(r.n) === p.rows;
}

/**
 * When the best single-column key repeats on both sides (county code 001 is in every state), look for a
 * second column pair that makes it a real key, like state × county or county × year. Only proposed if it
 * scores higher than the single key it extends.
 */
async function compositeCandidate(db: Db, lp: TableProfile, rp: TableProfile, found: JoinCandidate[]): Promise<JoinCandidate | null> {
  const base = found[0];
  if (!base || (base.features.leftUnique && base.features.rightUnique)) return null;
  const keyish = (c: ColumnProfile) => joinable(c.format) && c.nulls === 0 && c.distinct >= 2 && formatFamily(c.format) !== 'measure';
  const options: JoinCandidate[] = [];
  let tried = 0;
  for (const lo of lp.columns) for (const ro of rp.columns) {
    if (lo.name === base.left.column || ro.name === base.right.column || !keyish(lo) || !keyish(ro)) continue;
    const sim = nameSimilarity(lo.name, ro.name, lp.table, rp.table);
    const sameFamily = formatFamily(lo.format) === formatFamily(ro.format);
    if (!(sameFamily && formatFamily(lo.format) !== 'text') && sim < 0.5) continue;
    if (++tried > 30) break;
    for (const chain of normalisationChains(lo, ro)) {
      const also: KeyPair[] = [{ left: { table: lp.table, column: lo.name, transforms: chain.left }, right: { table: rp.table, column: ro.name, transforms: chain.right } }];
      const c = await containment(db, base.left, base.right, also);
      if (c.both === 0) continue;
      const features: Features = {
        ...base.features,
        containLeft: c.nl ? c.both / c.nl : 0,
        containRight: c.nr ? c.both / c.nr : 0,
        overlap: c.both,
        leftUnique: await compositeUnique(db, lp, [base.left, also[0].left]),
        rightUnique: await compositeUnique(db, rp, [base.right, also[0].right]),
        formatMatch: base.features.formatMatch && sameFamily,
        nameSim: (base.features.nameSim + sim) / 2,
        minDistinct: Math.min(base.features.minDistinct, lo.distinct, ro.distinct),
      };
      if (!features.leftUnique && !features.rightUnique) continue;
      const { score, reason } = scoreCandidate(features, base.left, base.right, also);
      if (score > base.score) options.push({ left: base.left, right: base.right, also, features, score, reason });
    }
  }
  options.sort((a, b) => b.score - a.score);
  dropDominatedLookups(options);
  return options[0] ?? null;
}

export async function findCandidates(db: Db, profiles: TableProfile[]): Promise<CandidateResult> {
  const pairs: PairResult[] = [];
  for (let i = 0; i < profiles.length; i++) for (let j = i + 1; j < profiles.length; j++) {
    pairs.push(await candidatesForPair(db, profiles[i], profiles[j]));
  }
  pairs.sort((a, b) => (b.best[0]?.score ?? -1) - (a.best[0]?.score ?? -1));
  return { pairs };
}
