import { describe, it, expect } from 'vitest';
import { buildReceipt, describeCastFailure, emitSqlScript, emitPython, TOOL, TOOL_VERSION, type Plan, type Mapping } from '../src';
import { setup, csv } from './helpers';

const key = (table: string, column: string, transforms: Plan['join']['left']['transforms'] = []) => ({ table, column, transforms });

describe('values a cast cannot convert', () => {
  it('counts rows whose key would not convert, says so, and the join still runs', async () => {
    const { db, profiles } = await setup({
      'l.csv': csv('zip,v', [['02134', 1], ['10001', 2], ['n/a', 3], ['unknown', 4], ['94105', 5]]),
      'r.csv': csv('zip,w', [[2134, 1], [10001, 2], [94105, 3]]),
    });
    const plan: Plan = { join: { op: 'join_on', how: 'left', left: key('l', 'zip', [{ op: 'cast', to: 'integer' }]), right: key('r', 'zip') } };
    const r = await buildReceipt(db, profiles, plan);
    expect(r.matchedLeft).toBe(3);
    expect(r.joinedRows).toBe(5);
    expect(r.castFailures).toEqual([{ side: 'left', table: 'l', column: 'zip', to: 'integer', rows: 2, example: 'n/a' }]);
    expect(describeCastFailure(r.castFailures[0], 'l.csv')).toBe('2 l.csv zip values didn\'t convert to a whole number, like "n/a". Those rows have no key, so they can\'t match.');
  });

  it('exports TRY_CAST and errors="coerce", so a value that will not convert never stops the script', () => {
    const m: Mapping = {
      tool: TOOL, version: TOOL_VERSION,
      tables: [{ name: 'l', file: 'l.csv', grain: null }, { name: 'r', file: 'r.csv', grain: null }],
      joins: [{
        id: 'l__r', how: 'left', aggregate_left: null, aggregate_right: null, status: 'approved', proposed_by: 'rule', llm: null,
        left: key('l', 'zip', [{ op: 'cast', to: 'integer' }]), right: key('r', 'day', [{ op: 'cast', to: 'date' }]),
        receipt: { matched: 1, unmatched_left: 0, unmatched_right: 0, joined_rows: 1, fanout: 1, max_per_key_right: 1 },
      }],
    };
    const sql = emitSqlScript(m), py = emitPython(m);
    expect(sql).toContain('TRY_CAST("l"."zip" AS BIGINT)');
    expect(sql).toContain('AS DATE)');
    expect(sql).not.toMatch(/(^|[^_])CAST\("l"\."zip"/);
    expect(py).toContain('pd.to_numeric(');
    expect(py.match(/errors="coerce"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('says nothing when every value converts, or no cast is used', async () => {
    const { db, profiles } = await setup({ 'l.csv': csv('zip,v', [['02134', 1]]), 'r.csv': csv('zip,w', [[2134, 1]]) });
    const a = await buildReceipt(db, profiles, { join: { op: 'join_on', how: 'left', left: key('l', 'zip', [{ op: 'cast', to: 'integer' }]), right: key('r', 'zip') } });
    expect(a.castFailures).toEqual([]);
    const b = await buildReceipt(db, profiles, { join: { op: 'join_on', how: 'left', left: key('l', 'zip'), right: key('r', 'zip') } });
    expect(b.castFailures).toEqual([]);
  });
});
