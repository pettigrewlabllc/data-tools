import { describe, expect, it } from 'vitest';
import { checkStatement, referencesOf, shapeOf, splitStatements } from '../src/static/sql.js';

const check = (sql: string) => { const state = { seeded: false }; return splitStatements(sql).flatMap((st, i) => checkStatement(st, 'q.sql', `s${i}`, state)); };
const causes = (sql: string) => check(sql).map((f) => `${f.cause}@${f.line}`);

describe('SQL splitter', () => {
  it("doesn't split on ; or see keywords inside strings and comments", () => {
    const sts = splitStatements("select 'a;limit' as x; -- now() ; limit\n/* random() */ select 2;\nselect $$;$$");
    expect(sts.map((s) => s.line)).toEqual([1, 2, 3]);
    expect(check("select 'now()' as x -- random()")).toEqual([]);
  });
  it('keeps line numbers across files and blocks', () => {
    expect(causes('select 1;\n\nselect\n  now();')).toEqual(['timestamp@4']);
  });
});

describe('SQL checks', () => {
  it('finds timestamps and random calls', () => {
    expect(causes('select now(), current_date, random(), uuid()')).toEqual(['timestamp@1', 'timestamp@1', 'random@1', 'random@1']);
  });
  it('skips random() after setseed()', () => {
    expect(causes('select setseed(0.5); select random()')).toEqual([]);
  });
  it('flags unseeded samples only', () => {
    expect(causes('select * from t using sample 10%')).toEqual(['unseeded_sample@1']);
    expect(causes('select * from t using sample 10% (bernoulli)')).toEqual(['unseeded_sample@1']);
    expect(causes('select * from t using sample 10% (bernoulli, 42)')).toEqual([]);
    expect(causes('select * from t using sample reservoir(10%) repeatable (7)')).toEqual([]);
    expect(causes('select * from t tablesample bernoulli(5)')).toEqual(['unseeded_sample@1']);
  });
  it('LIMIT without ORDER BY at the same level is an unordered limit; with one, a possible tie', () => {
    expect(causes('select * from t limit 5')).toEqual(['unordered_limit@1']);
    expect(causes('select * from t order by a limit 5')).toEqual(['ties@1']);
    expect(causes('select * from (select * from t limit 5) order by a')).toEqual(['unordered_limit@1']);
    expect(causes('select * from (select * from t order by a) limit 5')).toEqual(['unordered_limit@1']);
  });
  it('ROW_NUMBER over an ORDER BY is a tie candidate', () => {
    const f = check('select row_number() over (partition by g order by s) from t');
    expect(f.map((x) => [x.cause, x.kind])).toEqual([['ties', 'candidate']]);
  });
  it('unordered aggregates and arbitrary picks', () => {
    expect(causes("select string_agg(x, ','), list(y), first(z) from t")).toEqual(['set_order@1', 'set_order@1', 'set_order@1']);
    expect(causes("select string_agg(x, ',' order by x), list(y order by y) from t")).toEqual([]);
    expect(causes('select * from t order by a nulls first')).toEqual([]);
  });
  it('clean SQL has no findings', () => {
    expect(causes('create table a as select region, sum(x) s from read_csv(\'d.csv\') group by region;\nselect * from a order by s desc, region')).toEqual([]);
  });
});

describe('statement shapes and references', () => {
  it('knows tables, mutations, results and copies', () => {
    const [a, b, c, d, e] = splitStatements("create or replace temp table x as select 1; insert into x select 2; select * from x; copy (select 1) to 'o.csv'; set threads=1");
    expect(shapeOf(a)).toMatchObject({ kind: 'relation', target: 'x' });
    expect(shapeOf(b)).toMatchObject({ kind: 'mutation', target: 'x' });
    expect(shapeOf(c).kind).toBe('result');
    expect(shapeOf(d)).toMatchObject({ kind: 'copy', copyTo: 'o.csv' });
    expect(shapeOf(e).kind).toBe('other');
  });
  it('finds tables and files, and drops CTE names', () => {
    const [st] = splitStatements("with c as (select * from base) select * from c join other using (id) join read_csv('data/x.csv') r using (id)");
    const refs = referencesOf(st);
    expect(refs.tables.sort()).toEqual(['base', 'other']);
    expect(refs.files).toEqual(['data/x.csv']);
  });
});
