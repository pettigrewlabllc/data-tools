import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  findCandidates, buildReceipt, unmatchedExamples, validateJoinOn, toYaml, fromYaml, emitPython, planOf,
  TOOL, TOOL_VERSION, type Plan, type MappingJoin,
} from '../src';
import { setup, csv } from './helpers';

const PY = process.env.JR_PYTHON ?? '';
const COUNTIES = ['1001', '1003', '1005', '6037', '6001', '48201'];
const YEARS = [2021, 2022, 2023];

// Unemployment has every county × year, codes unpadded. Population pads codes and is missing 6001 in 2023.
const files = {
  'unemployment.csv': csv('fips,year,rate', COUNTIES.flatMap((c, i) => YEARS.map((y) => [c, y, (3 + i * 0.1 + (y - 2021) * 0.2).toFixed(1)]))),
  'population.csv': csv('county_fips,yr,pop', COUNTIES.flatMap((c, i) => YEARS.filter((y) => !(c === '6001' && y === 2023)).map((y) => [c.padStart(5, '0'), y, [9_800, 52_300, 410_000, 9_900_000, 1_640_000, 4_700_000][i] + (y - 2021) * 37]))),
};

const plan: Plan = {
  join: {
    op: 'join_on', how: 'left',
    left: { table: 'unemployment', column: 'fips', transforms: [{ op: 'lpad', width: 5, fill: '0' }] },
    right: { table: 'population', column: 'county_fips', transforms: [] },
    also: [{ left: { table: 'unemployment', column: 'year', transforms: [] }, right: { table: 'population', column: 'yr', transforms: [] } }],
  },
};

describe('two-column keys', () => {
  it('proposes county × year when both files are one row per that pair', async () => {
    const { db, profiles } = await setup(files);
    const { pairs } = await findCandidates(db, profiles);
    const top = pairs[0].best[0];
    expect(top.also?.map((p) => [p.left.column, p.right.column])).toEqual([['year', 'yr']]);
    expect(pairs[0].reliable).toBe(true);
    expect(top.reason).toContain('one row per key (fips × year = county_fips × yr)');
  });

  it('matches on every column, with no fan-out and the missing year reported', async () => {
    const { db, profiles } = await setup(files);
    const r = await buildReceipt(db, profiles, plan);
    expect(r.leftRows).toBe(18);
    expect(r.matchedLeft).toBe(17);
    expect(r.joinedRows).toBe(18);
    expect(r.fanoutWarning).toBe(false);
    expect(r.matchRateBefore).toBeCloseTo(3 / 18); // only 48201 is already five digits
    const ex = await unmatchedExamples(db, profiles, plan);
    expect(ex.left).toEqual(['6001 · 2023']);
  });

  it('the single-column version of the same join fans out', async () => {
    const { db, profiles } = await setup(files);
    const single = await buildReceipt(db, profiles, { join: { ...plan.join, also: undefined } });
    expect(single.fanoutWarning).toBe(true);
    expect(single.proposedAggregate?.by).toEqual(['county_fips']);
  });

  it('a row with half a key never matches', async () => {
    const { db, profiles } = await setup({
      'a.csv': csv('id,year,v', [['1', '2021', 1], ['2', '', 2]]),
      'b.csv': csv('id,year,w', [['1', '2021', 9], ['2', '', 8]]),
    });
    const r = await buildReceipt(db, profiles, { join: { op: 'join_on', how: 'left', left: { table: 'a', column: 'id', transforms: [] }, right: { table: 'b', column: 'id', transforms: [] }, also: [{ left: { table: 'a', column: 'year', transforms: [] }, right: { table: 'b', column: 'year', transforms: [] } }] } });
    expect(r.matchedLeft).toBe(1);
  });

  it('the validator accepts extra keys from the same tables and nothing else', () => {
    const schema = { unemployment: ['fips', 'year', 'rate'], population: ['county_fips', 'yr', 'pop'], other: ['x'] };
    expect(validateJoinOn(plan.join, schema).ok).toBe(true);
    const bad = (also: unknown) => validateJoinOn({ ...plan.join, also }, schema);
    expect(bad([{ left: { table: 'other', column: 'x', transforms: [] }, right: { table: 'population', column: 'yr', transforms: [] } }])).toMatchObject({ ok: false });
    expect(bad([{ left: { table: 'unemployment', column: 'fips', transforms: [] }, right: { table: 'population', column: 'yr', transforms: [] } }])).toMatchObject({ ok: false, error: 'each key column can only be used once' });
    expect(bad([1, 2, 3])).toMatchObject({ ok: false });
  });

  it('round-trips through mapping.yml, and pandas reproduces the row count', async () => {
    const { db, profiles } = await setup(files);
    const r = await buildReceipt(db, profiles, plan);
    const j: MappingJoin = {
      id: 'unemployment__population', left: plan.join.left, right: plan.join.right, how: 'left', also: plan.join.also,
      aggregate_left: null, aggregate_right: null, status: 'approved', proposed_by: 'rule', llm: null,
      receipt: { matched: r.matchedLeft, unmatched_left: r.unmatchedLeft, unmatched_right: r.unmatchedRight, joined_rows: r.joinedRows, fanout: r.fanout, max_per_key_right: r.maxPerKeyRight },
    };
    const m = { tool: TOOL, version: TOOL_VERSION, tables: profiles.map((p) => ({ name: p.table, file: p.file, grain: p.grain })), joins: [j] };
    const back = fromYaml(toYaml(m));
    expect(planOf(back.joins[0]).join.also).toEqual(plan.join.also);
    const py = emitPython(back);
    expect(py).toContain('+ "\\x1f" +');
    if (!PY || !existsSync(PY)) return;
    const dir = mkdtempSync(join(tmpdir(), 'jr-composite-'));
    for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);
    writeFileSync(join(dir, 'join.py'), py);
    execFileSync(PY, ['join.py'], { cwd: dir });
  });
});
