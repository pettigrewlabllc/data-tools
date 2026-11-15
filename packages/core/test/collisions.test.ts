import { describe, it, expect } from 'vitest';
import { buildReceipt, describeCollision, type Plan } from '../src';
import { setup, csv } from './helpers';

const key = (table: string, column: string, transforms: Plan['join']['left']['transforms'] = []) => ({ table, column, transforms });

describe('key collisions from cleanup', () => {
  it('reports when lowercasing makes two different keys the same, with the count and one example', async () => {
    const { db, profiles } = await setup({
      'l.csv': csv('code,v', [['ABC', 1], ['abc', 2], ['Def', 3], ['dEF', 4], ['xyz', 5]]),
      'r.csv': csv('code,w', [['abc', 1], ['def', 2], ['xyz', 3]]),
    });
    const r = await buildReceipt(db, profiles, { join: { op: 'join_on', how: 'left', left: key('l', 'code', [{ op: 'lower' }]), right: key('r', 'code') } });
    expect(r.collisions).toHaveLength(1);
    expect(r.collisions[0]).toMatchObject({ side: 'left', table: 'l', column: 'code', keys: 2, values: 4 });
    expect(r.collisions[0].example).toEqual(['ABC', 'abc']);
    expect(describeCollision(r.collisions[0], 'l.csv')).toBe(
      'The cleanup turned 4 different l.csv code values into 2 keys, so rows that were distinct now join as one. For example, "ABC" and "abc" both became "abc".',
    );
  });

  it('catches trim merging values that differ only in spaces', async () => {
    const { db, profiles } = await setup({
      'l.csv': 'id,v\n" A1",1\n"A1",2\n"B2",3\n',
      'r.csv': csv('id,w', [['A1', 1], ['B2', 2]]),
    });
    const r = await buildReceipt(db, profiles, { join: { op: 'join_on', how: 'left', left: key('l', 'id', [{ op: 'trim' }]), right: key('r', 'id') } });
    expect(r.collisions).toEqual([expect.objectContaining({ side: 'left', keys: 1, values: 2, example: [' A1', 'A1'] })]);
  });

  it('says nothing when the cleanup merges nothing, or there is no case or space cleanup', async () => {
    const { db, profiles } = await setup({
      'l.csv': csv('code,v', [['ABC', 1], ['DEF', 2]]),
      'r.csv': csv('code,w', [['abc', 1], ['def', 2]]),
    });
    const a = await buildReceipt(db, profiles, { join: { op: 'join_on', how: 'left', left: key('l', 'code', [{ op: 'lower' }]), right: key('r', 'code') } });
    expect(a.collisions).toEqual([]);
    const b = await buildReceipt(db, profiles, { join: { op: 'join_on', how: 'left', left: key('l', 'code'), right: key('r', 'code') } });
    expect(b.collisions).toEqual([]);
  });

  it('checks the right side too', async () => {
    const { db, profiles } = await setup({
      'l.csv': csv('code,v', [['abc', 1]]),
      'r.csv': csv('code,w', [['ABC', 1], ['Abc', 2], ['abc', 3]]),
    });
    const r = await buildReceipt(db, profiles, { join: { op: 'join_on', how: 'left', left: key('l', 'code'), right: key('r', 'code', [{ op: 'lower' }]) } });
    expect(r.collisions).toEqual([expect.objectContaining({ side: 'right', keys: 1, values: 3, example: ['ABC', 'Abc'] })]);
  });
});
