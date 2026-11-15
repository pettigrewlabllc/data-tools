/**
 * Format classes for JSON values. The set and the rules follow core's `classifyColumn` (Join Receipt), which
 * reads DuckDB column types; this version reads JSON values and adds URL, UUID and epoch timestamps.
 */
import { crosswalkValues } from '../shared/crosswalks';
import type { Scalar } from './grammar';

export type FormatClass =
  | 'email' | 'url' | 'uuid' | 'date' | 'timestamp' | 'epoch' | 'year' | 'currency'
  | 'us_state_abbr' | 'us_state_name' | 'us_state_fips' | 'county_fips' | 'iso2' | 'iso3' | 'country_name' | 'zip5'
  | 'integer_id' | 'text_id' | 'integer' | 'number' | 'boolean' | 'categorical' | 'free_text' | 'text' | 'unknown';

export type EpochUnit = 's' | 'ms' | 'us' | 'ns';

export const FORMAT_LABEL: Record<FormatClass, string> = {
  email: 'email', url: 'URL', uuid: 'UUID', date: 'date', timestamp: 'timestamp', epoch: 'epoch time', year: 'year',
  currency: 'currency text', us_state_abbr: 'state code', us_state_name: 'state name', us_state_fips: 'state FIPS',
  county_fips: 'county FIPS', iso2: 'country code (2)', iso3: 'country code (3)', country_name: 'country name',
  zip5: 'ZIP code', integer_id: 'number ID', text_id: 'text ID', integer: 'whole number', number: 'number',
  boolean: 'true/false', categorical: 'category', free_text: 'free text', text: 'text', unknown: 'unknown',
};

const STATE_ABBR = crosswalkValues('us_state', 'abbr');
const STATE_NAME = crosswalkValues('us_state', 'name');
const STATE_FIPS = crosswalkValues('us_state', 'fips');
const ISO2 = crosswalkValues('country', 'iso2');
const ISO3 = crosswalkValues('country', 'iso3');
const COUNTRY_NAME = crosswalkValues('country', 'name');

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
export const US_DATE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const NUMERIC_TEXT = /^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;
const INT_TEXT = /^-?\d+$/;

/** Epoch seconds 1990–2040 span 6.3e8–2.2e9; each finer unit is 10^3 larger. */
const EPOCH_RANGES: [EpochUnit, number, number][] = [
  ['s', 6.3e8, 2.3e9], ['ms', 6.3e11, 2.3e12], ['us', 6.3e14, 2.3e15], ['ns', 6.3e17, 2.3e18],
];

/** The epoch unit whose 1990–2040 window holds this number, if any. Works on digit strings (big integers) too. */
export function epochUnit(v: Scalar): EpochUnit | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && INT_TEXT.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  for (const [u, lo, hi] of EPOCH_RANGES) if (n >= lo && n <= hi) return u;
  return null;
}

/** Seconds since 1970 for an epoch reading of `v` in unit `u`. */
export function epochSeconds(v: Scalar, u: EpochUnit): number {
  const n = Number(v);
  return u === 's' ? n : u === 'ms' ? n / 1e3 : u === 'us' ? n / 1e6 : n / 1e9;
}

export interface ClassifyInput { name: string; values: Scalar[]; distinct: number }

export function classifyValues(c: ClassifyInput): { format: FormatClass; epoch?: EpochUnit } {
  const vs = c.values.filter((v) => v !== null && v !== '');
  if (vs.length === 0) return { format: 'unknown' };
  const name = c.name.toLowerCase();
  const strs = vs.map((v) => String(v).trim());
  const share = (pred: (v: string, raw: Scalar) => boolean) => strs.filter((s, i) => pred(s, vs[i])).length / strs.length;
  const most = (pred: (v: string, raw: Scalar) => boolean) => share(pred) >= 0.9;
  const hint = (...w: string[]) => w.some((x) => name.includes(x));
  const allBool = vs.every((v) => typeof v === 'boolean');
  const numbers = vs.every((v) => typeof v === 'number');
  const ints = most((s, raw) => (typeof raw === 'number' && Number.isInteger(raw)) || (typeof raw === 'string' && INT_TEXT.test(s)));
  const intType = vs.every((v) => typeof v === 'number' && Number.isInteger(v)) || (vs.every((v) => typeof v === 'string' && INT_TEXT.test(v)) && strs.some((s) => s.length > 15));

  if (allBool) return { format: 'boolean' };
  if (most((s) => EMAIL.test(s))) return { format: 'email' };
  if (most((s) => URL_RE.test(s))) return { format: 'url' };
  if (most((s) => UUID.test(s))) return { format: 'uuid' };
  if (most((s) => ISO_DATE.test(s))) return { format: 'date' };
  if (most((s) => ISO_TS.test(s))) return { format: 'timestamp' };
  if (most((s) => US_DATE.test(s))) return { format: 'date' };
  if (ints) {
    const units = vs.map(epochUnit);
    const u = units[0];
    const timeName = hint('time', 'date', 'created', 'updated', 'modified', '_at', 'ts', 'epoch', 'when');
    if (u && units.every((x) => x === u) && (timeName || u !== 's')) return { format: 'epoch', epoch: u };
  }
  if (hint('zip', 'postal') && most((s) => /^\d{5}(-\d{4})?$/.test(s))) return { format: 'zip5' };
  if (hint('fips', 'county', 'geoid') && most((s) => /^\d{4,5}$/.test(s) && STATE_FIPS.has(s.padStart(5, '0').slice(0, 2)))) return { format: 'county_fips' };
  if (hint('fips', 'state') && most((s) => /^\d{1,2}$/.test(s) && STATE_FIPS.has(s.padStart(2, '0')))) return { format: 'us_state_fips' };
  if (!numbers) {
    const abbr = share((s) => STATE_ABBR.has(s.toUpperCase()));
    const iso2 = share((s) => ISO2.has(s.toUpperCase()));
    if (abbr >= 0.9 && (iso2 < 0.9 || !hint('country', 'nation', 'iso'))) return { format: 'us_state_abbr' };
    if (iso2 >= 0.9) return { format: 'iso2' };
    if (most((s) => ISO3.has(s.toUpperCase()))) return { format: 'iso3' };
    if (most((s) => STATE_NAME.has(s.toUpperCase()))) return { format: 'us_state_name' };
    if (most((s) => COUNTRY_NAME.has(s.toUpperCase()))) return { format: 'country_name' };
    if (most((s) => /^[$€£]\s?-?[\d,]+(\.\d+)?$/.test(s))) return { format: 'currency' };
  }
  if (ints && hint('year', 'yr') && most((s) => /^\d{4}$/.test(s) && +s >= 1800 && +s <= 2100)) return { format: 'year' };
  const idName = /(^id$|_id$|id$|_key$|_code$|code$|_no$|number$|_num$|_ref$|^ref$|uid$|guid$)/.test(name);
  if (ints && (idName || intType && strs.some((s) => s.length > 15))) return { format: 'integer_id' };
  if (numbers) return { format: ints ? 'integer' : 'number' };
  if (most((s) => NUMERIC_TEXT.test(s))) return { format: ints ? 'integer' : 'number' };
  const maxLen = Math.max(...strs.map((s) => s.length));
  if (maxLen > 40 && share((s) => s.includes(' ')) >= 0.5) return { format: 'free_text' };
  if (idName && share((s) => !s.includes(' ')) >= 0.9) return { format: 'text_id' };
  if (c.distinct <= 50 && c.distinct <= Math.max(3, 0.5 * vs.length) && vs.length >= 4) return { format: 'categorical' };
  if (share((s) => !s.includes(' ')) >= 0.9 && c.distinct === vs.length && vs.length >= 3 && /\d/.test(strs[0])) return { format: 'text_id' };
  return { format: 'text' };
}

export const isNumericText = (s: string) => NUMERIC_TEXT.test(s);
export const isIntText = (s: string) => INT_TEXT.test(s);
