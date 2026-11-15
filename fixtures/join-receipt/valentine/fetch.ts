/**
 * Downloads the Valentine benchmark (ICDE'21) and the 10 NYC Open Data pairs from the Valentine repo into a cache
 * outside git, once. Nothing here is committed: the data is fetched at run time, see SOURCES.md for licences.
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const CACHE = process.env.VALENTINE_CACHE ?? join(homedir(), '.cache', 'data-tools', 'valentine');
export const ZENODO = 'https://zenodo.org/records/5084605/files/Valentine-datasets.zip?download=1';
export const ZIP_BYTES = 602150347;
/** delftdata/valentine at a fixed commit, so the NYC pairs and their ground truth can't change under us. */
export const NYC_COMMIT = 'f6f801971b674a520a07094c184582b7a77d48c5';
export const NYC_PAIRS = [
  'City_Government__Capital_Projects', 'City_Government__DCM_StreetCenterLine', 'City_Government__DPR_AthleticFacilities_001',
  'City_Government__DSNY_Districts_With_Disposal_Vendor_Assignments', 'City_Government__NYC_Municipal_Building_Energy_Benchmarking_Results',
  'Education__COVID-19_Free_Meals_Locations', 'Housing_&_Development__Housing_Maintenance_Code_Complaints_and_Problems',
  'Housing_&_Development__Public_Design_Commission_Outdoor_Public_Art_Invent', 'Recreation__Swim_for_Life__2016_to_2020',
  'Transportation__DOT_In-house_Street_Resurfacing_Projects',
];
export const SOURCES = ['ChEMBL', 'OpenData', 'TPC-DI'] as const;

export const joinableDir = (source: string) => join(CACHE, 'Valentine-datasets', source, 'Joinable');
export const nycDir = (pair: string) => join(CACHE, 'nyc', pair);

async function download(url: string, to: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

export async function ensureData(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  if (!SOURCES.every((s) => existsSync(joinableDir(s)))) {
    const zip = join(CACHE, 'Valentine-datasets.zip');
    if (!existsSync(zip)) {
      console.log(`Downloading Valentine (${(ZIP_BYTES / 1e6).toFixed(0)} MB) to ${CACHE} ...`);
      execFileSync('curl', ['-sSL', '--fail', '-o', zip, ZENODO], { stdio: 'inherit' });
    }
    execFileSync('unzip', ['-q', '-o', zip, '-d', CACHE], { stdio: 'inherit' });
  }
  for (const pair of NYC_PAIRS) {
    const dir = nycDir(pair);
    mkdirSync(dir, { recursive: true });
    for (const f of ['source_table.csv', 'target_table.csv', 'ground_truth.json']) {
      if (existsSync(join(dir, f))) continue;
      const path = ['experiments', 'data', pair, f].map(encodeURIComponent).join('/');
      await download(`https://raw.githubusercontent.com/delftdata/valentine/${NYC_COMMIT}/${path}`, join(dir, f));
    }
  }
}

/** Every Joinable pair folder, as { source, id, dir }. */
export function joinablePairs(): { source: string; id: string; dir: string }[] {
  return SOURCES.flatMap((source) => readdirSync(joinableDir(source)).filter((d) => !d.startsWith('.')).sort().map((id) => ({ source, id, dir: join(joinableDir(source), id) })));
}
