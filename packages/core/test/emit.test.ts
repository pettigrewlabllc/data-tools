import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createNodeDb } from '@data-tools/core-node';
import { buildReceipt, toYaml, fromYaml, emitSqlScript, emitPython, TOOL, TOOL_VERSION, type Mapping, type MappingJoin, type Plan } from '../src';
import { setup, csv } from './helpers';

const PY = process.env.JR_PYTHON ?? '';

const files = {
  'counties.csv': csv('fips,name,state', [[1001, 'Autauga', 'AL'], [1003, 'Baldwin', 'AL'], [2013, 'Aleutians', 'AK'], [6037, 'LA', 'CA'], [6001, 'Alameda', 'CA']]),
  'daily.csv': csv('county_fips,day,sales', ['01001', '01003', '06037', '06001'].flatMap((c) => [[c, '2024-01-01', 2], [c, '2024-01-02', 3]])),
  'names.csv': csv('state_name,pop', [['Alabama', 5], ['alaska ', 1], ['California', 39], ['Texas', 30]]),
};

async function mappingFor(): Promise<Mapping> {
  const { db, profiles } = await setup(files);
  const plan: Plan = {
    join: { op: 'join_on', how: 'left', left: { table: 'counties', column: 'fips', transforms: [{ op: 'lpad', width: 5, fill: '0' }] }, right: { table: 'daily', column: 'county_fips', transforms: [] } },
    aggregateRight: { op: 'aggregate', table: 'daily', by: ['county_fips'], measures: [{ column: 'day', fn: 'first' }, { column: 'sales', fn: 'sum' }] },
  };
  const plan2: Plan = {
    join: { op: 'join_on', how: 'inner', left: { table: 'counties', column: 'state', transforms: [] }, right: { table: 'names', column: 'state_name', transforms: [{ op: 'crosswalk', table: 'us_state', from: 'name', to: 'abbr' }] } },
  };
  const joins: MappingJoin[] = [];
  for (const [id, p] of [['counties__daily', plan], ['counties__names', plan2]] as const) {
    const r = await buildReceipt(db, profiles, p);
    joins.push({
      id, left: p.join.left, right: p.join.right, how: p.join.how, aggregate_left: null, aggregate_right: p.aggregateRight ?? null,
      status: 'approved', proposed_by: 'rule', llm: null,
      receipt: { matched: r.matchedLeft, unmatched_left: r.unmatchedLeft, unmatched_right: r.unmatchedRight, joined_rows: r.joinedRows, fanout: r.fanout, max_per_key_right: r.maxPerKeyRight },
    });
  }
  return { tool: TOOL, version: TOOL_VERSION, tables: profiles.map((p) => ({ name: p.table, file: p.file, grain: p.grain })), joins };
}

describe('mapping.yml', () => {
  it('round-trips, including strings that look like numbers or null', async () => {
    const m = await mappingFor();
    m.tables.push({ name: 'odd', file: '01001.csv', grain: ['0', 'null', '2024', 'true'] });
    const text = toYaml(m);
    expect(fromYaml(text)).toEqual(fromYaml(toYaml(fromYaml(text))));
    expect(fromYaml(text).tables.at(-1)).toEqual({ name: 'odd', file: '01001.csv', grain: ['0', 'null', '2024', 'true'] });
    expect(fromYaml(text).joins[0].left.transforms).toEqual([{ op: 'lpad', width: 5, fill: '0' }]);
    expect(text).toContain("fill: \"0\"");
  });
  it('regenerates byte-identical SQL and Python', async () => {
    const m = await mappingFor();
    const again = fromYaml(toYaml(m));
    expect(emitSqlScript(again)).toBe(emitSqlScript(m));
    expect(emitPython(again)).toBe(emitPython(m));
    expect(toYaml(again)).toBe(toYaml(m));
  });
});

describe('exported code reproduces the receipt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jr-emit-'));
  for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);

  it('SQL script returns the receipt row counts', async () => {
    const m = await mappingFor();
    const db = await createNodeDb();
    await db.query(`SET file_search_path = '${dir.replace(/'/g, "''")}'`);
    const statements = emitSqlScript(m).split(/;\n/).filter((s) => s.includes('SELECT'));
    expect(statements).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const rows = await db.query(statements[i]);
      expect(rows.length).toBe(m.joins[i].receipt.joined_rows);
    }
    expect(m.joins[0].receipt.joined_rows).toBe(5);
    expect(m.joins[1].receipt.joined_rows).toBe(5);
  });

  it.skipIf(!PY || !existsSync(PY))('pandas snippet asserts the same row counts', async () => {
    const m = await mappingFor();
    const code = emitPython(m);
    expect(code).toContain('rjust(5, "0")');
    writeFileSync(join(dir, 'join.py'), code);
    const out = execFileSync(PY, ['join.py'], { cwd: dir, encoding: 'utf8' });
    expect(out).toBe('');
  });
});
