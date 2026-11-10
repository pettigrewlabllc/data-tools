import type { CodeKind, CrosswalkTable } from '../grammar';

export type CrosswalkRow = Partial<Record<CodeKind, string>> & { name: string };

/** US states, DC and Puerto Rico. Source: U.S. Census Bureau, FIPS state codes (ANSI INCITS 38). */
export const US_STATES: CrosswalkRow[] = [
  ['Alabama', 'AL', '01'], ['Alaska', 'AK', '02'], ['Arizona', 'AZ', '04'], ['Arkansas', 'AR', '05'],
  ['California', 'CA', '06'], ['Colorado', 'CO', '08'], ['Connecticut', 'CT', '09'], ['Delaware', 'DE', '10'],
  ['District of Columbia', 'DC', '11'], ['Florida', 'FL', '12'], ['Georgia', 'GA', '13'], ['Hawaii', 'HI', '15'],
  ['Idaho', 'ID', '16'], ['Illinois', 'IL', '17'], ['Indiana', 'IN', '18'], ['Iowa', 'IA', '19'],
  ['Kansas', 'KS', '20'], ['Kentucky', 'KY', '21'], ['Louisiana', 'LA', '22'], ['Maine', 'ME', '23'],
  ['Maryland', 'MD', '24'], ['Massachusetts', 'MA', '25'], ['Michigan', 'MI', '26'], ['Minnesota', 'MN', '27'],
  ['Mississippi', 'MS', '28'], ['Missouri', 'MO', '29'], ['Montana', 'MT', '30'], ['Nebraska', 'NE', '31'],
  ['Nevada', 'NV', '32'], ['New Hampshire', 'NH', '33'], ['New Jersey', 'NJ', '34'], ['New Mexico', 'NM', '35'],
  ['New York', 'NY', '36'], ['North Carolina', 'NC', '37'], ['North Dakota', 'ND', '38'], ['Ohio', 'OH', '39'],
  ['Oklahoma', 'OK', '40'], ['Oregon', 'OR', '41'], ['Pennsylvania', 'PA', '42'], ['Rhode Island', 'RI', '44'],
  ['South Carolina', 'SC', '45'], ['South Dakota', 'SD', '46'], ['Tennessee', 'TN', '47'], ['Texas', 'TX', '48'],
  ['Utah', 'UT', '49'], ['Vermont', 'VT', '50'], ['Virginia', 'VA', '51'], ['Washington', 'WA', '53'],
  ['West Virginia', 'WV', '54'], ['Wisconsin', 'WI', '55'], ['Wyoming', 'WY', '56'], ['Puerto Rico', 'PR', '72'],
].map(([name, abbr, fips]) => ({ name, abbr, fips }));

/** A common subset of ISO 3166-1. Source: ISO 3166-1 country codes (alpha-2, alpha-3), short English names. */
export const COUNTRIES: CrosswalkRow[] = [
  ['Argentina', 'AR', 'ARG'], ['Australia', 'AU', 'AUS'], ['Austria', 'AT', 'AUT'], ['Bangladesh', 'BD', 'BGD'],
  ['Belgium', 'BE', 'BEL'], ['Brazil', 'BR', 'BRA'], ['Canada', 'CA', 'CAN'], ['Chile', 'CL', 'CHL'],
  ['China', 'CN', 'CHN'], ['Colombia', 'CO', 'COL'], ['Czechia', 'CZ', 'CZE'], ['Denmark', 'DK', 'DNK'],
  ['Egypt', 'EG', 'EGY'], ['Ethiopia', 'ET', 'ETH'], ['Finland', 'FI', 'FIN'], ['France', 'FR', 'FRA'],
  ['Germany', 'DE', 'DEU'], ['Ghana', 'GH', 'GHA'], ['Greece', 'GR', 'GRC'], ['Hungary', 'HU', 'HUN'],
  ['India', 'IN', 'IND'], ['Indonesia', 'ID', 'IDN'], ['Iran', 'IR', 'IRN'], ['Iraq', 'IQ', 'IRQ'],
  ['Ireland', 'IE', 'IRL'], ['Israel', 'IL', 'ISR'], ['Italy', 'IT', 'ITA'], ['Japan', 'JP', 'JPN'],
  ['Kenya', 'KE', 'KEN'], ['Malaysia', 'MY', 'MYS'], ['Mexico', 'MX', 'MEX'], ['Morocco', 'MA', 'MAR'],
  ['Netherlands', 'NL', 'NLD'], ['New Zealand', 'NZ', 'NZL'], ['Nigeria', 'NG', 'NGA'], ['Norway', 'NO', 'NOR'],
  ['Pakistan', 'PK', 'PAK'], ['Peru', 'PE', 'PER'], ['Philippines', 'PH', 'PHL'], ['Poland', 'PL', 'POL'],
  ['Portugal', 'PT', 'PRT'], ['Romania', 'RO', 'ROU'], ['Russia', 'RU', 'RUS'], ['Saudi Arabia', 'SA', 'SAU'],
  ['Singapore', 'SG', 'SGP'], ['South Africa', 'ZA', 'ZAF'], ['South Korea', 'KR', 'KOR'], ['Spain', 'ES', 'ESP'],
  ['Sweden', 'SE', 'SWE'], ['Switzerland', 'CH', 'CHE'], ['Thailand', 'TH', 'THA'], ['Turkey', 'TR', 'TUR'],
  ['Ukraine', 'UA', 'UKR'], ['United Arab Emirates', 'AE', 'ARE'], ['United Kingdom', 'GB', 'GBR'],
  ['United States', 'US', 'USA'], ['Venezuela', 'VE', 'VEN'], ['Vietnam', 'VN', 'VNM'],
].map(([name, iso2, iso3]) => ({ name, iso2, iso3 }));

export const CROSSWALKS: Record<CrosswalkTable, { rows: CrosswalkRow[]; kinds: CodeKind[]; source: string }> = {
  us_state: { rows: US_STATES, kinds: ['name', 'abbr', 'fips'], source: 'U.S. Census Bureau FIPS state codes' },
  country: { rows: COUNTRIES, kinds: ['name', 'iso2', 'iso3'], source: 'ISO 3166-1 (subset)' },
};

/** Set of every value in a crosswalk, upper-cased, for classification and masking. */
export function crosswalkValues(table: CrosswalkTable, kind: CodeKind): Set<string> {
  return new Set(CROSSWALKS[table].rows.map((r) => r[kind]).filter((v): v is string => !!v).map((v) => v.toUpperCase()));
}
