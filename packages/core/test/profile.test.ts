import { describe, it, expect } from 'vitest';
import { createNodeDb } from '@data-tools/core-node';
import { loadFile, classifyColumn, tableNameFor, keyExpr, US_STATES, COUNTRIES } from '../src';
import { enc, setup, csv } from './helpers';

const cls = (name: string, samples: string[], type = 'VARCHAR', distinct = samples.length, rows = samples.length * 3) =>
  classifyColumn({ name, type, samples, distinct, rows, maxLen: Math.max(...samples.map((s) => s.length)) });

describe('load', () => {
  it('names tables safely and de-duplicates', () => {
    const t = new Set<string>();
    expect(tableNameFor('County Data (2024).csv', t)).toBe('county_data_2024');
    expect(tableNameFor('county data 2024.csv', t)).toBe('county_data_2024_2');
    expect(tableNameFor('2024.csv', t)).toBe('t_2024');
  });
  it('loads csv, ndjson and parquet, and names a failing file', async () => {
    const db = await createNodeDb();
    const taken = new Set<string>();
    expect(await loadFile(db, 'a.csv', enc('id,x\n1,a\n2,b\n'), taken)).toMatchObject({ ok: true, name: 'a', rows: 2 });
    expect(await loadFile(db, 'b.ndjson', enc('{"id":1}\n{"id":2}\n{"id":3}\n'), taken)).toMatchObject({ ok: true, rows: 3 });
    await db.query(`COPY (SELECT * FROM a) TO '${db.resolve('a.csv')}.parquet' (FORMAT parquet)`);
    const { readFileSync } = await import('node:fs');
    const pq = readFileSync(`${db.resolve('a.csv')}.parquet`);
    expect(await loadFile(db, 'c.parquet', new Uint8Array(pq), taken)).toMatchObject({ ok: true, rows: 2 });
    const bad = await loadFile(db, 'd.parquet', enc('not parquet'), taken);
    expect(bad.ok).toBe(false);
    expect(bad).toMatchObject({ file: 'd.parquet' });
    expect(await loadFile(db, 'e.xlsx', enc('x'), taken)).toMatchObject({ ok: false, file: 'e.xlsx' });
  });
});

describe('format classes', () => {
  it('recognises common key formats', () => {
    expect(cls('geo', ['01001', '01003', '02013', '06037'])).toBe('county_fips');
    expect(cls('fips', ['1001', '1003', '2013', '6037'], 'BIGINT')).toBe('county_fips');
    expect(cls('state', ['AL', 'AK', 'WY', 'TX'])).toBe('us_state_abbr');
    expect(cls('state', ['Alabama', 'alaska', 'Texas'])).toBe('us_state_name');
    expect(cls('state_fips', ['1', '2', '56'], 'BIGINT')).toBe('us_state_fips');
    expect(cls('contact', ['a@b.co', 'c.d@e.org'])).toBe('email');
    expect(cls('day', ['2024-01-01', '2024-02-01'])).toBe('date');
    expect(cls('day', ['2024-01-01'], 'DATE')).toBe('date');
    expect(cls('country', ['FR', 'DE', 'US'])).toBe('iso2');
    expect(cls('c', ['FRA', 'DEU', 'USA'])).toBe('iso3');
    expect(cls('year', ['2019', '2020'], 'BIGINT', 2, 100)).toBe('year');
    expect(cls('amount', ['1.5', '2.25'], 'DOUBLE')).toBe('numeric');
    expect(cls('customer_id', ['10', '11', '12'], 'BIGINT')).toBe('integer_id');
  });
  it('keeps crosswalk lookups unique so a scalar subquery never returns two rows', () => {
    for (const [rows, kinds] of [[US_STATES, ['name', 'abbr', 'fips']], [COUNTRIES, ['name', 'iso2', 'iso3']]] as const) {
      for (const k of kinds) {
        const vals = rows.map((r) => (r as Record<string, string>)[k].toUpperCase());
        expect(new Set(vals).size).toBe(vals.length);
      }
    }
  });
});

describe('profile', () => {
  it('counts distinct, nulls and finds a single-column grain', async () => {
    const { profiles } = await setup({ 't.csv': csv('id,state,value', [[1, 'AL', 3], [2, 'AL', ''], [3, 'AK', 5]]) });
    const p = profiles[0];
    expect(p.rows).toBe(3);
    const state = p.columns.find((c) => c.name === 'state')!;
    expect(state.distinct).toBe(2);
    const value = p.columns.find((c) => c.name === 'value')!;
    expect(value.nulls).toBe(1);
    expect(p.grain).toEqual(['id']);
  });
  it('finds a two-column grain for daily data', async () => {
    const rows = [];
    for (const d of ['2024-01-01', '2024-01-02', '2024-01-03']) for (const c of ['01001', '01003']) rows.push([d, c, 1]);
    const { profiles } = await setup({ 'daily.csv': csv('date,county,value', rows) });
    expect(profiles[0].grain?.sort()).toEqual(['county', 'date']);
  });
  it('compares keys as text, so an integer never silently matches a zero-padded code', async () => {
    const { db } = await setup({ 'a.csv': csv('fips', [[1001]]), 'b.csv': csv('fips', [['01001']]) });
    const l = keyExpr({ table: 'a', column: 'fips', transforms: [] }, 'a');
    const r = keyExpr({ table: 'b', column: 'fips', transforms: [] }, 'b');
    const [{ n }] = await db.query(`SELECT count(*) AS n FROM a JOIN b ON ${l} = ${r}`);
    expect(n).toBe(0);
  });
});
