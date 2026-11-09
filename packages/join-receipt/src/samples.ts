import { US_STATES } from '@data-tools/core';

/**
 * Synthetic sample files shaped like Census county data, built in the browser so there's nothing to download.
 * The trouble is planted on purpose: unpadded county codes, Alaska missing from one file, and daily rows that
 * would triple a county-level join.
 */
export function sampleFiles(): { name: string; bytes: Uint8Array }[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const words = ['Oak', 'Elm', 'Cedar', 'Bear', 'Clay', 'Lake', 'Rock', 'Pine', 'Mill', 'Fox', 'Iron', 'Salt'];
  const counties = US_STATES.slice(0, 40).flatMap((s) =>
    Array.from({ length: 3 + Math.floor(rnd() * 6) }, (_, k) => ({
      fips: `${s.fips}${String(1 + 2 * k).padStart(3, '0')}`, state: s.abbr!, name: `${words[Math.floor(rnd() * words.length)]} County`,
    })),
  );
  const enc = (s: string) => new TextEncoder().encode(s);
  const counties_csv = ['fips,county_name,state,population', ...counties.map((c) => `${Number(c.fips)},${c.name},${c.state},${1000 + Math.floor(rnd() * 900000)}`)].join('\n');
  const unemployment = ['county_fips,year,unemployment_rate,labor_force', ...counties.filter((c) => c.state !== 'AK').map((c) => `${c.fips},2024,${(2 + rnd() * 6).toFixed(1)},${500 + Math.floor(rnd() * 400000)}`)].join('\n');
  const days = ['2024-03-01', '2024-03-02', '2024-03-03'];
  const daily = ['county_fips,date,store_visits', ...counties.flatMap((c) => days.map((d) => `${c.fips},${d},${Math.floor(rnd() * 500)}`))].join('\n');
  return [
    { name: 'counties.csv', bytes: enc(counties_csv + '\n') },
    { name: 'unemployment_2024.csv', bytes: enc(unemployment + '\n') },
    { name: 'store_visits_daily.csv', bytes: enc(daily + '\n') },
  ];
}
