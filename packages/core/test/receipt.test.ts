import { describe, it, expect } from 'vitest';
import { buildReceipt, describePattern, type Plan } from '../src';
import { setup, csv } from './helpers';

const key = (table: string, column: string, transforms: Plan['join']['left']['transforms'] = []) => ({ table, column, transforms });

describe('receipt', () => {
  it('names what the unmatched rows have in common', async () => {
    const left = [
      ...['AL', 'AL', 'AZ', 'AZ', 'CA', 'CA', 'CO'].map((s, i) => [`k${i}`, s]),
      ['k7', 'AK'], ['k8', 'AK'], ['k9', 'AK'],
    ];
    const { db, profiles } = await setup({
      'l.csv': csv('id,state', left),
      'r.csv': csv('id,v', left.slice(0, 7).map(([k], i) => [k, i])),
    });
    const r = await buildReceipt(db, profiles, { join: { op: 'join_on', how: 'left', left: key('l', 'id'), right: key('r', 'id') } });
    expect(r.matchedLeft).toBe(7);
    expect(r.unmatchedLeft).toBe(3);
    expect(r.patternsLeft[0]).toMatchObject({ column: 'state', value: 'AK', unmatchedCount: 3 });
    expect(r.patternsLeft[0].lift).toBeCloseTo(3.33, 1);
    expect(describePattern(r.patternsLeft[0])).toBe('All 3 unmatched rows have state = AK (AK is 30% of the file).');
    expect(r.patternsLeft).toHaveLength(1);
  });

  it('never reports a column with fewer than 3 distinct values', async () => {
    const left = Array.from({ length: 10 }, (_, i) => [`k${i}`, i < 7 ? 'yes' : 'no']);
    const { db, profiles } = await setup({ 'l.csv': csv('id,flag', left), 'r.csv': csv('id', left.slice(0, 7).map(([k]) => [k])) });
    const r = await buildReceipt(db, profiles, { join: { op: 'join_on', how: 'left', left: key('l', 'id'), right: key('r', 'id') } });
    expect(r.patternsLeft).toEqual([]);
  });

  it('catches fan-out, proposes a roll-up, and the roll-up removes it', async () => {
    const counties = ['01001', '01003', '01005', '02013'];
    const daily = counties.flatMap((c) => ['2024-01-01', '2024-01-02', '2024-01-03'].map((d) => [c, d, 10]));
    const { db, profiles } = await setup({
      'counties.csv': csv('fips,name', counties.map((c, i) => [c, `C${i}`])),
      'daily.csv': csv('fips,day,sales', daily),
    });
    const plan: Plan = { join: { op: 'join_on', how: 'left', left: key('counties', 'fips'), right: key('daily', 'fips') } };
    const r = await buildReceipt(db, profiles, plan);
    expect(r.fanout).toBe(3);
    expect(r.joinedRows).toBe(12);
    expect(r.fanoutWarning).toBe(true);
    expect(r.proposedAggregate?.measures).toEqual([{ column: 'day', fn: 'first' }, { column: 'sales', fn: 'sum' }]);
    const fixed = await buildReceipt(db, profiles, { ...plan, aggregateRight: r.proposedAggregate });
    expect(fixed.fanout).toBe(1);
    expect(fixed.joinedRows).toBe(4);
    expect(fixed.fanoutWarning).toBe(false);
    const rows = await db.query(fixed.sql + ' ORDER BY 1');
    expect(rows[0]).toMatchObject({ fips: '01001', sales: 30 });
  });

  it('measures fan-out against matched rows, so drops on an inner join cannot hide it', async () => {
    const { db, profiles } = await setup({
      'l.csv': csv('id', [['a'], ['b'], ['c'], ['d']]),
      'r.csv': csv('id,v', [['a', 1], ['a', 2], ['b', 3], ['b', 4]]),
    });
    const r = await buildReceipt(db, profiles, { join: { op: 'join_on', how: 'inner', left: key('l', 'id'), right: key('r', 'id') } });
    expect(r.joinedRows).toBe(4);
    expect(r.fanout).toBe(2);
    expect(r.fanoutWarning).toBe(true);
  });

  it('shows the match rate before and after zero-padding, with before/after samples', async () => {
    const { db, profiles } = await setup({
      'a.csv': csv('fips', [[1001], [1003], [2013], [10001], [10003], [10005], [10007], [10009]]),
      'b.csv': csv('county_fips', [['01001'], ['01003'], ['02013'], ['10001'], ['10003'], ['10005'], ['10007'], ['10009']]),
    });
    const r = await buildReceipt(db, profiles, { join: { op: 'join_on', how: 'left', left: key('a', 'fips', [{ op: 'lpad', width: 5, fill: '0' }]), right: key('b', 'county_fips') } });
    expect(r.matchRateBefore).toBe(5 / 8);
    expect(r.matchRateAfter).toBe(1);
    expect(r.samples.slice(0, 3).every((x) => x.raw !== x.transformed)).toBe(true);
    expect(r.samples).toContainEqual({ side: 'left', raw: '1001', transformed: '01001' });
    expect(r.normalisations).toBe('zero-padding to 5');
  });
});
