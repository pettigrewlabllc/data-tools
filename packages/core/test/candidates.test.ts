import { describe, it, expect } from 'vitest';
import { findCandidates, nameSimilarity } from '../src';
import { setup, csv } from './helpers';

const counties = [['01001', 'AL'], ['01003', 'AL'], ['01005', 'AL'], ['02013', 'AK'], ['02016', 'AK'], ['04001', 'AZ'], ['04003', 'AZ'], ['06001', 'CA'], ['06003', 'CA'], ['06005', 'CA']];

describe('candidates', () => {
  it('reads a bare id as the table id', () => {
    expect(nameSimilarity('customer_id', 'id', 'orders', 'customers')).toBe(1);
    expect(nameSimilarity('fips', 'county_fips')).toBe(0.5);
  });

  it('finds an unpadded FIPS join and says it needs zero-padding', async () => {
    const { db, profiles } = await setup({
      'counties.csv': csv('fips,name', counties.map(([f], i) => [Number(f), `County ${i}`])),
      'unemployment.csv': csv('county_fips,state,rate', counties.map(([f, s], i) => [f, s, 3 + i / 10])),
    });
    const { pairs } = await findCandidates(db, profiles);
    const top = pairs[0].best[0];
    expect([top.left.column, top.right.column]).toEqual(['fips', 'county_fips']);
    expect(top.left.transforms).toEqual([{ op: 'lpad', width: 5, fill: '0' }]);
    expect(top.score).toBeGreaterThanOrEqual(80);
    expect(top.reason).toContain('zero-padding');
    expect(pairs[0].reliable).toBe(true);
  });

  it('crosswalks state names to codes', async () => {
    const { db, profiles } = await setup({
      'pop.csv': csv('state_name,pop', [['Alabama', 5], ['Alaska', 1], ['Arizona', 7], ['California', 39], ['Texas', 30]]),
      'gdp.csv': csv('state,gdp', [['AL', 1], ['AK', 2], ['AZ', 3], ['CA', 4], ['TX', 5]]),
    });
    const top = (await findCandidates(db, profiles)).pairs[0].best[0];
    expect(top.left.transforms[0]).toMatchObject({ op: 'crosswalk', from: 'name', to: 'abbr' });
    expect(top.features.containLeft).toBe(1);
  });

  it('prefers a real unique key over a shared many-to-many dimension', async () => {
    const { db, profiles } = await setup({
      'a.csv': csv('fips,state,x', counties.map(([f, s]) => [f, s, 1])),
      'b.csv': csv('geoid,state,y', counties.map(([f, s]) => [f, s, 2])),
    });
    const top = (await findCandidates(db, profiles)).pairs[0].best[0];
    expect(top.left.column).toBe('fips');
  });

  it('does not join two row-number id columns when a real key exists', async () => {
    const people = Array.from({ length: 12 }, (_, i) => [i + 1, `p${i}@x.com`]);
    const { db, profiles } = await setup({
      'customers.csv': csv('id,email', people),
      'surveys.csv': csv('id,contact_email,score', people.map(([, e], i) => [i + 1, e, 5]).reverse()),
    });
    const top = (await findCandidates(db, profiles)).pairs[0].best[0];
    expect(top.left.column).toBe('email');
  });

  it('says plainly when there is no reliable join, with up to three near-misses', async () => {
    const { db, profiles } = await setup({
      'a.csv': csv('code,v', [['X1', 1], ['X2', 2], ['X3', 3], ['X4', 4]]),
      'b.csv': csv('code,w', [['X1', 1], ['Y2', 2], ['Y3', 3], ['Y4', 4], ['Y5', 5], ['Y6', 6]]),
    });
    const p = (await findCandidates(db, profiles)).pairs[0];
    expect(p.reliable).toBe(false);
    expect(p.best.length).toBeLessThanOrEqual(3);
  });
});

describe('scoreColumns', () => {
  it('scores a hand-picked key with the same cleanup search, and falls back to the raw columns', async () => {
    const { createNodeDb } = await import('@data-tools/core-node');
    const { loadFile, profileTable, scoreColumns } = await import('../src');
    const db = await createNodeDb();
    const taken = new Set<string>();
    const load = async (n: string, t: string) => { const r = await loadFile(db, n, new TextEncoder().encode(t), taken); if (!r.ok) throw new Error(r.error); return profileTable(db, r.name, r.file); };
    const a = await load('a.csv', 'fips,x\n1001,1\n1003,2\n6037,3\n');
    const b = await load('b.csv', 'county,y\n01001,a\n01003,b\n06037,c\n');
    const c = await scoreColumns(db, a, b, 'fips', 'county');
    expect(c.left.transforms).toEqual([{ op: 'lpad', width: 5, fill: '0' }]);
    expect(c.features.containLeft).toBe(1);
    const none = await scoreColumns(db, a, b, 'x', 'y');
    expect(none.features.overlap).toBe(0);
    await expect(scoreColumns(db, a, b, 'nope', 'y')).rejects.toThrow('no column a.nope');
  });
});
