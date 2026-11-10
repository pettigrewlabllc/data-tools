import { describe, it, expect } from 'vitest';
import { createNodeDb } from '@data-tools/core-node';
import { validateTransform, validateTransforms, validateJoinOn, validateAggregate } from '../src/grammar';
import { ident, lit } from '../src/sql/quote';
import { keyExpr, crosswalkCtes, withClause } from '../src/sql/emit';
import { US_STATES } from '../src/sql/crosswalks';

const schema = { a: ['fips', 'name'], b: ['county_fips', 'value'] };

describe('grammar', () => {
  it('accepts every allowed op', () => {
    for (const t of [
      { op: 'trim' }, { op: 'lower' }, { op: 'upper' }, { op: 'lpad', width: 5, fill: '0' },
      { op: 'crosswalk', table: 'us_state', from: 'name', to: 'abbr' }, { op: 'cast', to: 'varchar' },
      { op: 'date_trunc', unit: 'year' },
    ]) expect(validateTransform(t).ok).toBe(true);
  });
  it('rejects anything outside the grammar', () => {
    const bad = [
      { op: 'sql', text: 'drop table a' }, { op: 'lpad', width: 0, fill: '0' }, { op: 'lpad', width: 21, fill: '0' },
      { op: 'lpad', width: 1.5, fill: '0' }, { op: 'lpad', width: 5, fill: '' }, { op: 'lpad', width: 5, fill: "'" },
      { op: 'trim', x: 1 }, { op: 'crosswalk', table: 'country', from: 'name', to: 'fips' },
      { op: 'crosswalk', table: 'us_state', from: 'abbr', to: 'abbr' }, 'trim', null, [],
    ];
    for (const t of bad) expect(validateTransform(t).ok).toBe(false);
    const r = validateTransform({ op: 'sql' });
    expect(!r.ok && r.error).toContain('"sql" is not an allowed operation');
  });
  it('caps transforms per key', () => {
    expect(validateTransforms(Array(7).fill({ op: 'trim' })).ok).toBe(false);
  });
  it('checks tables and columns exist', () => {
    const j = (col: string) => ({ op: 'join_on', how: 'left', left: { table: 'a', column: col, transforms: [] }, right: { table: 'b', column: 'county_fips', transforms: [] } });
    expect(validateJoinOn(j('fips'), schema).ok).toBe(true);
    expect(validateJoinOn(j('nope'), schema).ok).toBe(false);
    expect(validateJoinOn({ ...j('fips'), how: 'cross' }, schema).ok).toBe(false);
    expect(validateJoinOn(j('__proto__'), schema).ok).toBe(false);
    expect(validateAggregate({ op: 'aggregate', table: 'b', by: ['county_fips'], measures: [{ column: 'value', fn: 'sum' }] }, schema).ok).toBe(true);
    expect(validateAggregate({ op: 'aggregate', table: 'b', by: ['county_fips'], measures: [{ column: 'value', fn: 'median' }] }, schema).ok).toBe(false);
  });
});

describe('sql emit', () => {
  it('quotes identifiers and literals', () => {
    expect(ident('a"b')).toBe('"a""b"');
    expect(lit("it's")).toBe("'it''s'");
    expect(() => lit(NaN)).toThrow();
  });
  it('zero-pads an integer key', async () => {
    const db = await createNodeDb();
    const e = keyExpr({ table: 't', column: 'fips', transforms: [{ op: 'lpad', width: 5, fill: '0' }] }, 't');
    expect(await db.query(`SELECT ${e} AS k FROM (SELECT 1001 AS fips) t`)).toEqual([{ k: '01001' }]);
  });
  it('crosswalks state names to abbreviations, case-insensitively, and fips ints to names', async () => {
    const db = await createNodeDb();
    const a = { table: 't', column: 'v', transforms: [{ op: 'crosswalk', table: 'us_state', from: 'name', to: 'abbr' } as const] };
    const f = { table: 't', column: 'n', transforms: [{ op: 'crosswalk', table: 'us_state', from: 'fips', to: 'name' } as const] };
    const sql = `${withClause(crosswalkCtes([a, f]))}SELECT ${keyExpr(a, 't')} AS k, ${keyExpr(f, 't')} AS m FROM (SELECT ' alabama ' AS v, 2 AS n) t`;
    expect(await db.query(sql)).toEqual([{ k: 'AL', m: 'Alaska' }]);
  });
  it('has 52 states with unique fips', () => {
    expect(US_STATES).toHaveLength(52);
    expect(new Set(US_STATES.map((s) => s.fips)).size).toBe(52);
  });
});
