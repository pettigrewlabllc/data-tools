import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2019 from 'ajv/dist/2019';
import { parse } from 'yaml';
import { buildReceipt, contractYaml, TOOL, TOOL_VERSION, type Mapping, type MappingJoin, type Plan } from '../src';
import { setup, csv } from './helpers';

const schema = JSON.parse(readFileSync(new URL('../src/odcs/odcs-3.2.0.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2019({ strict: false, allErrors: true });
const validate = ajv.compile(schema);

const files = {
  'counties.csv': csv('State FIPS Code,County FIPS Code,name,state', [[1, 1, 'Autauga', 'AL'], [1, 3, 'Baldwin', 'AL'], [2, 13, 'Aleutians', 'AK'], [2, 16, 'Aleutians W', 'AK'], [2, 20, 'Anchorage', 'AK'], [6, 37, 'LA', 'CA'], [1, 5, 'Barbour', 'AL'], [1, 7, 'Bibb', 'AL'], [6, 1, 'Alameda', 'CA'], [6, 3, 'Alpine', 'CA']]),
  'pop.csv': csv('STATE,COUNTY,pop', [['01', 1, 5], ['01', 3, 7], ['06', 37, 9], ['01', 5, 2], ['01', 7, 3], ['06', 1, 8], ['06', 3, 1]]),
};

async function build(status: MappingJoin['status'] = 'approved') {
  const { db, profiles } = await setup(files);
  const plan: Plan = {
    join: {
      op: 'join_on', how: 'left',
      left: { table: 'counties', column: 'State FIPS Code', transforms: [{ op: 'lpad', width: 2, fill: '0' }] },
      right: { table: 'pop', column: 'STATE', transforms: [] },
      also: [{ left: { table: 'counties', column: 'County FIPS Code', transforms: [] }, right: { table: 'pop', column: 'COUNTY', transforms: [] } }],
    },
  };
  const r = await buildReceipt(db, profiles, plan);
  const j: MappingJoin = {
    id: 'counties__pop', left: plan.join.left, right: plan.join.right, how: 'left', also: plan.join.also, aggregate_left: null, aggregate_right: null,
    status, proposed_by: 'rule', llm: null,
    receipt: { matched: r.matchedLeft, unmatched_left: r.unmatchedLeft, unmatched_right: r.unmatchedRight, joined_rows: r.joinedRows, fanout: r.fanout, max_per_key_right: r.maxPerKeyRight },
  };
  const m: Mapping = { tool: TOOL, version: TOOL_VERSION, tables: profiles.map((p) => ({ name: p.table, file: p.file, grain: p.grain })), joins: [j] };
  return { db, r, text: contractYaml(m, profiles, { counties__pop: { left: r.patternsLeft, right: r.patternsRight } }) };
}

describe('contract.yml (ODCS 3.2.0)', () => {
  it('validates against the ODCS 3.2.0 JSON Schema', async () => {
    const { text } = await build();
    const doc = parse(text);
    const ok = validate(doc);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
    expect(doc.apiVersion).toBe('v3.2.0');
    // And the validator isn't waving everything through:
    expect(validate({ ...doc, kind: 'Contract' })).toBe(false);
    const bad = structuredClone(doc);
    bad.schema[0].relationships = [{ type: 'foreignKey', from: ['a.b'], to: 'c.d' }];
    expect(validate(bad)).toBe(false);
  });

  it('puts the join key in relationships, with arrays for a composite key', async () => {
    const doc = parse((await build()).text);
    const counties = doc.schema.find((s: { name: string }) => s.name === 'counties');
    expect(counties.relationships).toEqual([expect.objectContaining({
      type: 'foreignKey',
      from: ['schema/counties/properties/State_FIPS_Code', 'schema/counties/properties/County_FIPS_Code'],
      to: ['schema/pop/properties/STATE', 'schema/pop/properties/COUNTY'],
    })]);
    const cleanup = counties.relationships[0].customProperties.find((c: { property: string }) => c.property === 'keyCleanup');
    expect(cleanup.value.left).toEqual([{ column: 'State FIPS Code', steps: [{ op: 'lpad', width: 2, fill: '0' }] }]);
    expect(counties.properties.map((p: { name: string }) => p.name)).toContain('State FIPS Code');
  });

  it('records the match rate as a SQL quality check, and the query reproduces it', async () => {
    const { db, r, text } = await build();
    const q = parse(text).schema.find((s: { name: string }) => s.name === 'counties').quality[0];
    expect(q).toMatchObject({ type: 'sql', unit: 'percent', dimension: 'consistency', mustBeGreaterOrEqualTo: 70 });
    expect(r.matchedLeft).toBe(7);
    const [row] = await db.query(q.query);
    expect(Number(Object.values(row)[0])).toBeCloseTo(70, 5);
  });

  it('puts what the unmatched rows share in customProperties', async () => {
    const doc = parse((await build()).text);
    const rel = doc.schema.find((s: { name: string }) => s.name === 'counties').relationships[0];
    const pats = rel.customProperties.find((c: { property: string }) => c.property === 'unmatchedPatterns');
    expect(pats.value.left[0]).toMatchObject({ column: 'state', value: 'AK', unmatchedRows: 3, ofUnmatched: 3 });
  });

  it('leaves out joins that were not approved, and still validates', async () => {
    const doc = parse((await build('rejected')).text);
    expect(doc.schema.some((s: { relationships?: unknown }) => s.relationships)).toBe(false);
    expect(validate(doc)).toBe(true);
  });
});
