import { crosswalkValues } from './sql/crosswalks';

export type FormatClass =
  | 'us_state_fips' | 'county_fips' | 'us_state_abbr' | 'us_state_name'
  | 'iso2' | 'iso3' | 'country_name' | 'zip5' | 'email' | 'date' | 'timestamp' | 'year'
  | 'currency' | 'integer_id' | 'text_id' | 'numeric' | 'free_text' | 'categorical' | 'boolean' | 'unknown';

export type FormatFamily = 'us_state' | 'county' | 'country' | 'zip' | 'email' | 'temporal' | 'id' | 'text' | 'measure' | 'other';

export function formatFamily(f: FormatClass): FormatFamily {
  switch (f) {
    case 'us_state_fips': case 'us_state_abbr': case 'us_state_name': return 'us_state';
    case 'county_fips': return 'county';
    case 'iso2': case 'iso3': case 'country_name': return 'country';
    case 'zip5': return 'zip';
    case 'email': return 'email';
    case 'date': case 'timestamp': case 'year': return 'temporal';
    case 'integer_id': case 'text_id': return 'id';
    case 'categorical': case 'unknown': return 'text';
    case 'numeric': case 'currency': return 'measure';
    default: return 'other';
  }
}

/** Families whose columns can be join keys. */
export function joinable(f: FormatClass): boolean {
  return !['numeric', 'currency', 'free_text', 'boolean'].includes(f);
}

export const FORMAT_LABEL: Record<FormatClass, string> = {
  us_state_fips: 'state FIPS', county_fips: 'county FIPS', us_state_abbr: 'state code', us_state_name: 'state name',
  iso2: 'country code (2)', iso3: 'country code (3)', country_name: 'country name', zip5: 'ZIP code', email: 'email',
  date: 'date', timestamp: 'timestamp', year: 'year', currency: 'currency', integer_id: 'number ID', text_id: 'text ID',
  numeric: 'number', free_text: 'free text', categorical: 'category', boolean: 'yes/no', unknown: 'text',
};

const STATE_ABBR = crosswalkValues('us_state', 'abbr');
const STATE_NAME = crosswalkValues('us_state', 'name');
const STATE_FIPS = crosswalkValues('us_state', 'fips');
const ISO2 = crosswalkValues('country', 'iso2');
const ISO3 = crosswalkValues('country', 'iso3');
const COUNTRY_NAME = crosswalkValues('country', 'name');

export interface ClassifyInput { name: string; type: string; samples: string[]; distinct: number; rows: number; maxLen: number; minLen?: number }

const NUMERIC_TYPES = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|DOUBLE|DECIMAL)/;
const INT_TYPES = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT)/;

export function classifyColumn(c: ClassifyInput): FormatClass {
  const s = c.samples.map((v) => v.trim()).filter((v) => v !== '');
  const name = c.name.toLowerCase();
  const share = (pred: (v: string) => boolean) => (s.length ? s.filter(pred).length / s.length : 0);
  const most = (pred: (v: string) => boolean) => share(pred) >= 0.9;
  const hint = (...words: string[]) => words.some((w) => name.includes(w));
  const isInt = INT_TYPES.test(c.type) || most((v) => /^-?\d+$/.test(v));
  const isNum = NUMERIC_TYPES.test(c.type);
  if (s.length === 0) return 'unknown';

  if (c.type === 'BOOLEAN' || (c.distinct <= 2 && most((v) => /^(true|false|t|f|y|n|yes|no|0|1)$/i.test(v)))) return 'boolean';
  if (c.type === 'DATE') return 'date';
  if (c.type.startsWith('TIMESTAMP')) return 'timestamp';
  if (most((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))) return 'email';
  if (most((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'date';
  if (most((v) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v))) return 'timestamp';

  // Geography. County FIPS: 4-5 digits whose state part is a real state code.
  const countyLike = (v: string) => /^\d{4,5}$/.test(v) && STATE_FIPS.has(v.padStart(5, '0').slice(0, 2));
  if (hint('zip', 'postal') && most((v) => /^\d{3,5}$/.test(v))) return 'zip5';
  // County FIPS codes are odd-numbered, which separates them from ordinary 4-5 digit numbers.
  const oddCounty = most((v) => countyLike(v) && Number(v) % 2 === 1);
  if (most(countyLike) && (hint('fips', 'county', 'geoid', 'fip') || most((v) => /^\d{5}$/.test(v)) || oddCounty)) return 'county_fips';
  if (hint('fips', 'state') && most((v) => /^\d{1,2}$/.test(v) && STATE_FIPS.has(v.padStart(2, '0')))) return 'us_state_fips';
  const abbr = share((v) => STATE_ABBR.has(v.toUpperCase()));
  const iso2 = share((v) => ISO2.has(v.toUpperCase()));
  if (abbr >= 0.9 && (iso2 < 0.9 || !hint('country', 'nation', 'iso'))) return 'us_state_abbr';
  if (iso2 >= 0.9) return 'iso2';
  if (most((v) => ISO3.has(v.toUpperCase()))) return 'iso3';
  if (most((v) => STATE_NAME.has(v.toUpperCase()))) return 'us_state_name';
  // Census state files list the U.S., regions and divisions beside the states, so allow a quarter of other names
  // when the column is named like one.
  if (hint('name', 'state') && share((v) => STATE_NAME.has(v.toUpperCase())) >= 0.75) return 'us_state_name';
  if (most((v) => COUNTRY_NAME.has(v.toUpperCase()))) return 'country_name';

  if (isInt && hint('year', 'yr') && most((v) => /^\d{4}$/.test(v) && +v >= 1800 && +v <= 2100)) return 'year';
  if (most((v) => /^[$€£]\s?-?[\d,]+(\.\d+)?$/.test(v))) return 'currency';
  const idName = /(^id$|_id$|id$|_key$|_code$|code$|_no$|number$|_num$|_ref$|^ref$)/.test(name);
  if (isInt && (idName || (c.distinct === c.rows && !isNum))) return 'integer_id';
  // A unique, fixed-width whole number is an identifier, not a measure.
  if (isInt && c.distinct === c.rows && c.rows >= 10 && c.minLen !== undefined && c.minLen === c.maxLen && c.maxLen >= 3) return 'integer_id';
  if (isNum) return 'numeric';
  if (c.maxLen > 40 && share((v) => v.includes(' ')) >= 0.5) return 'free_text';
  if (c.distinct <= 50 && c.distinct <= Math.max(2, 0.2 * c.rows)) return 'categorical';
  if (idName || share((v) => !v.includes(' ')) >= 0.9) return 'text_id';
  return 'unknown';
}
