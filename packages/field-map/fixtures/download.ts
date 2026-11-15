/**
 * Downloads the public API samples once. Run by hand (`npm run fixtures:download`); the results are committed
 * with their source, date and licence in samples/SOURCES.json, and no test ever touches the network.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UA = 'field-map-fixtures (github.com/pettigrewlabllc/data-tools)';
const SOURCES = [
  { file: 'usgs-quakes.json', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson', licence: 'Public domain (U.S. Geological Survey)', note: 'GeoJSON; epoch milliseconds in properties.time' },
  { file: 'nobel-prizes.json', url: 'https://api.nobelprize.org/2.1/nobelPrizes?limit=30&nobelPrizeYear=2019&yearTo=2024', licence: 'CC0 (Nobel Prize Outreach, api.nobelprize.org terms)', note: 'Line items: laureates[]' },
  { file: 'openalex-works.json', url: 'https://api.openalex.org/works?filter=publication_year:2024,type:article&per_page=30&select=id,doi,title,publication_year,publication_date,cited_by_count,authorships,open_access,language,type,biblio', licence: 'CC0 (OpenAlex)', note: 'Line items: authorships[]; affiliations dropped at download to keep the file small' },
  { file: 'nws-forecast.json', url: 'https://api.weather.gov/gridpoints/TOP/31,80/forecast', licence: 'Public domain (U.S. National Weather Service)', note: 'GeoJSON; periods[] under properties' },
  { file: 'fec-candidates.json', url: 'https://api.open.fec.gov/v1/candidates/?api_key=DEMO_KEY&per_page=30&sort=name&election_year=2024&office=S', licence: 'Public domain (U.S. Federal Election Commission)', note: 'Uses the public DEMO_KEY' },
];

const out: unknown[] = [];
for (const s of SOURCES) {
  const res = await fetch(s.url, { headers: { 'user-agent': UA, accept: 'application/geo+json, application/json' } });
  if (!res.ok) throw new Error(`${s.url}: ${res.status}`);
  let text = await res.text();
  // OpenAlex affiliations are most of its bytes and none of the tasks; keep each author's own fields.
  if (s.file.startsWith('openalex')) {
    const d = JSON.parse(text);
    for (const w of d.results) w.authorships = w.authorships.map((a: Record<string, any>) => ({ author_position: a.author_position, author: { id: a.author?.id, display_name: a.author?.display_name, orcid: a.author?.orcid ?? null }, is_corresponding: a.is_corresponding, countries: a.countries }));
    text = JSON.stringify(d, null, 1);
  }
  JSON.parse(text);
  writeFileSync(join(import.meta.dirname, 'samples', s.file), text.trim() + '\n');
  out.push({ ...s, url: s.url.replace(/api_key=[^&]+/, 'api_key=DEMO_KEY'), downloaded: new Date().toISOString().slice(0, 10), bytes: text.length });
  console.log(`${s.file}: ${text.length} bytes`);
}
writeFileSync(join(import.meta.dirname, 'samples', 'SOURCES.json'), JSON.stringify(out, null, 2) + '\n');
