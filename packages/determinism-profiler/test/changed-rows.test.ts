import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import { diffByKey, findKey, rowHashExpr } from '../src/changed-rows.js';

async function db(sql: string) {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  await conn.run(sql);
  return conn;
}
const side = async (conn: Awaited<ReturnType<typeof db>>, table: string) => ({ conn, table, rowHash: await rowHashExpr(conn, table) });

describe('changed-row bisection', () => {
  it('finds the few keys that differ among 100,000 rows', async () => {
    const a = await db('CREATE TABLE t AS SELECT i AS order_id, i % 7 AS g, (i * 3)::BIGINT AS amount FROM range(100000) r(i)');
    const b = await db(`CREATE TABLE t AS SELECT i AS order_id, i % 7 AS g, (i * 3)::BIGINT AS amount FROM range(100000) r(i) WHERE i <> 50000;
      UPDATE t SET amount = amount + 1 WHERE order_id IN (17, 73001);
      INSERT INTO t VALUES (100500, 1, 0);`);
    expect(await findKey(a, 't', b, 't')).toBe('order_id');
    const res = await diffByKey(await side(a, 't'), await side(b, 't'), 'order_id');
    expect(res.more).toBe(false);
    expect(res.rows.sort((x, y) => Number(x.key) - Number(y.key))).toEqual([
      { key: '17', change: 'changed' },
      { key: '50000', change: 'only_a' },
      { key: '73001', change: 'changed' },
      { key: '100500', change: 'only_b' },
    ]);
  });
  it('stops at 10 and says there are more', async () => {
    const a = await db('CREATE TABLE t AS SELECT i AS id, i AS v FROM range(5000) r(i)');
    const b = await db('CREATE TABLE t AS SELECT i AS id, CASE WHEN i % 100 = 0 THEN -1 ELSE i END AS v FROM range(5000) r(i)');
    const res = await diffByKey(await side(a, 't'), await side(b, 't'), 'id');
    expect(res.rows).toHaveLength(10);
    expect(res.more).toBe(true);
  });
  it('exactly 10 changed rows is not "more"', async () => {
    const a = await db('CREATE TABLE t AS SELECT i AS id, i AS v FROM range(5000) r(i)');
    const b = await db('CREATE TABLE t AS SELECT i AS id, CASE WHEN i % 500 = 0 THEN -1 ELSE i END AS v FROM range(5000) r(i)');
    const res = await diffByKey(await side(a, 't'), await side(b, 't'), 'id');
    expect(res.rows).toHaveLength(10);
    expect(res.more).toBe(false);
  });
  it('works on text keys', async () => {
    const a = await db("CREATE TABLE t AS SELECT 'c' || i::VARCHAR AS customer, i AS v FROM range(300) r(i)");
    const b = await db("CREATE TABLE t AS SELECT 'c' || i::VARCHAR AS customer, CASE WHEN i = 222 THEN 0 ELSE i END AS v FROM range(300) r(i)");
    expect((await diffByKey(await side(a, 't'), await side(b, 't'), 'customer')).rows).toEqual([{ key: 'c222', change: 'changed' }]);
  });
  it('finds no key when nothing is unique, and never picks a float', async () => {
    const a = await db('CREATE TABLE t AS SELECT i % 3 AS g, random() AS r FROM range(30) x(i)');
    expect(await findKey(a, 't', a, 't')).toBeNull();
  });
});

describe('keep policy (memory follows what changed)', () => {
  it('a run keeps only the steps the policy asks for, and never views', async () => {
    const { planSql, runSqlOnce } = await import('../src/runners/sql.js');
    const { join } = await import('node:path');
    const { FIX } = await import('./helpers.js');
    const plan = planSql(join(FIX, 'sql-changed-rows'));
    const all = await runSqlOnce(plan, null, () => true);
    const some = await runSqlOnce(plan, null, (id) => id.startsWith('02_'));
    try {
      expect([...all.kept!.tables.keys()].sort()).toEqual(['01_customers.sql:1', '02_adjusted.sql:2', '03_regions.sql:2']);
      expect([...all.kept!.views]).toEqual(['04_view.sql:2']);
      expect([...some.kept!.tables.keys()]).toEqual(['02_adjusted.sql:2']);
    } finally {
      all.kept!.close();
      some.kept!.close();
    }
  });
});
