import { describe, it, expect } from 'vitest';
import { createNodeDb } from '@data-tools/core-node';

const enc = (s: string) => new TextEncoder().encode(s);

describe('NodeDb', () => {
  it('runs a query and returns plain numbers', async () => {
    const db = await createNodeDb();
    expect(await db.query('select 1::bigint as x')).toEqual([{ x: 1 }]);
  });
  it('reads a registered file', async () => {
    const db = await createNodeDb();
    await db.registerFile('a.csv', enc('id\n1\n2\n'));
    const rows = await db.query(`select count(*) as n from read_csv_auto('${db.resolve('a.csv')}')`);
    expect(rows).toEqual([{ n: 2 }]);
  });
});
