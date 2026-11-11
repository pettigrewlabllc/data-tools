import { describe, it, expect } from 'vitest';
import { createNodeDb } from '@data-tools/core-node';
import { loadFile, profileTable, candidatesForPair, classifyColumn, type TableProfile } from '../src';
import { enc } from './helpers';

const STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho'];
const FIPS = ['01', '02', '04', '05', '06', '08', '09', '10', '12', '13', '15', '16'];

// Like the Census state population file: one row per state, plus total rows that all use state code 00.
const totalsFile = 'SUMLEV,STATE,NAME,POP\n010,00,United States,1000\n020,00,West Region,400\n020,00,South Region,600\n'
  + STATES.map((s, i) => `040,${FIPS[i]},${s},${10 + i}`).join('\n') + '\n';
const countyFile = 'STATE,COUNTY,CTYNAME\n' + FIPS.flatMap((f, i) => [`${f},001,${STATES[i]} One`, `${f},003,${STATES[i]} Three`]).join('\n') + '\n';

async function load(db: Awaited<ReturnType<typeof createNodeDb>>, name: string, text: string, taken: Set<string>): Promise<TableProfile> {
  const r = await loadFile(db, name, enc(text), taken);
  if (!r.ok) throw new Error(r.error);
  return profileTable(db, r.name, r.file);
}

describe('total rows that share one code', () => {
  it('marks a code column unique apart from the totals', async () => {
    const db = await createNodeDb();
    const p = await load(db, 'states.csv', totalsFile, new Set());
    const state = p.columns.find((c) => c.name === 'STATE')!;
    expect(state.unique).toBe(false);
    expect(state.nearUnique).toEqual({ value: '00', rows: 3 });
    expect(p.columns.find((c) => c.name === 'SUMLEV')!.nearUnique).toBeUndefined();
  });

  it('proposes the state code with confidence and says why', async () => {
    const db = await createNodeDb();
    const taken = new Set<string>();
    const lp = await load(db, 'states.csv', totalsFile, taken), rp = await load(db, 'counties.csv', countyFile, taken);
    const pr = await candidatesForPair(db, lp, rp);
    expect(pr.reliable).toBe(true);
    expect([pr.best[0].left.column, pr.best[0].right.column]).toEqual(['STATE', 'STATE']);
    expect(pr.best[0].reason).toContain('unique except for 3 rows that share 00');
  });

  it("doesn't treat a column with many repeats as nearly unique", async () => {
    const db = await createNodeDb();
    const text = 'k\n' + [...Array(12)].map((_, i) => (i < 6 ? 'x' : `v${i}`)).join('\n') + '\n';
    const p = await load(db, 'repeats.csv', text, new Set());
    expect(p.columns[0].nearUnique).toBeUndefined();
  });

  it('reads a NAME column of states plus regions as state names', () => {
    const samples = [...STATES, 'United States', 'West Region', 'South Region'];
    expect(classifyColumn({ name: 'NAME', type: 'VARCHAR', samples, distinct: samples.length, rows: samples.length, maxLen: 13, minLen: 4 })).toBe('us_state_name');
    expect(classifyColumn({ name: 'label', type: 'VARCHAR', samples, distinct: samples.length, rows: samples.length, maxLen: 13, minLen: 4 })).not.toBe('us_state_name');
  });
});
