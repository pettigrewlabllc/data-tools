import { describe, expect, it } from 'vitest';
import { loadFiles, loadText, parseJson } from '../src/engine/json';
import { profileRecords } from '../src/engine/profile';
import { targetFromColumns, targetFromExample, targetFromSchema } from '../src/engine/target';
import { recommend, T } from '../src/engine/recommend';
import { validateMapping as checkGrammar } from '../src/engine/grammar';
import { compileJsonata } from '../src/engine/emit-jsonata';
import { readFieldMap, writeFieldMap, mappingsOf, JSONATA_VERSION, TOOL_VERSION } from '../src/engine/fieldmap-yml';
import { acceptDrafts } from '../src/engine/ai/drafts';
import { buildPayload, maskValue } from '../src/engine/ai/payload';
import { classifyValues } from '../src/engine/formats';

const orders = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `o${i}`, list_price: 20 + i, sale_price: 18 + i, unit_price: 9 + i, amount: 1999 + i, created: 1763100000 + i * 3600,
  buyer: { email_address: `p${i}@example.com`, first_name: 'Ada', last_name: `L${i}` }, items: [{ sku: `S${i}`, qty: 1 }],
}));

async function rec(records: unknown[], schema: object) {
  const f = loadText('t.json', JSON.stringify(records));
  return recommend(targetFromSchema(JSON.stringify({ type: 'object', properties: schema })), profileRecords(f.records, f.bigIntPaths), f.records);
}

describe('loading', () => {
  it('keeps integers above 2^53 exact, as text, and says where', () => {
    const r = parseJson('{"id": 12345678901234567890, "n": 5, "f": 1.5, "s": "a\\"b"}');
    expect(r.value).toEqual({ id: '12345678901234567890', n: 5, f: 1.5, s: 'a"b' });
    expect([...r.bigIntPaths]).toEqual(['id']);
  });
  it('finds records in an envelope, reads NDJSON, and names each bad file', () => {
    expect(loadText('a', '{"type":"x","features":[{"a":1},{"a":2}]}').records).toHaveLength(2);
    expect(loadText('b', '{"a":1}\n{"a":2}\n').records).toHaveLength(2);
    const r = loadFiles([{ name: 'good.json', text: '[{"a":1}]' }, { name: 'bad.json', text: '{"a":' }, { name: 'empty.json', text: '' }]);
    expect(r.records).toHaveLength(1);
    expect(r.errors.map((e) => e.name)).toEqual(['bad.json', 'empty.json']);
  });
  it('refuses more than 50 files', () => {
    expect(loadFiles(Array.from({ length: 51 }, (_, i) => ({ name: `${i}`, text: '{}' }))).errors[0].reason).toMatch(/50 files/);
  });
});

describe('profiling and formats', () => {
  it('describes nested paths and line items, with epoch units by magnitude', () => {
    const p = profileRecords(orders(12) as never);
    const by = (id: string) => p.paths.find((x) => x.id === id)!;
    expect(by('buyer.email_address').format).toBe('email');
    expect(by('created')).toMatchObject({ format: 'epoch', epoch: 's' });
    expect(by('items[]').kind).toBe('object_array');
    expect(by('items[].sku').context).toEqual(['items']);
  });
  it('knows URLs, UUIDs and millisecond epochs', () => {
    expect(classifyValues({ name: 'link', values: ['https://a.com/x', 'https://b.org'], distinct: 2 }).format).toBe('url');
    expect(classifyValues({ name: 'ref', values: ['123e4567-e89b-12d3-a456-426614174000'], distinct: 1 }).format).toBe('uuid');
    expect(classifyValues({ name: 'time', values: [1794695026411], distinct: 1 })).toEqual({ format: 'epoch', epoch: 'ms' });
  });
});

describe('targets', () => {
  it('reads local $ref and refuses a remote one without fetching', () => {
    const t = targetFromSchema(JSON.stringify({ $defs: { e: { type: 'string', format: 'email' } }, type: 'object', properties: { email: { $ref: '#/$defs/e' } } }));
    expect(t.fields[0]).toMatchObject({ id: 'email', type: 'string', format: 'email' });
    expect(() => targetFromSchema(JSON.stringify({ type: 'object', properties: { a: { $ref: 'https://example.com/s.json' } } }))).toThrow(/https:\/\/example.com\/s.json.*nothing is fetched/);
  });
  it('infers a schema from an example and loosens it on request', () => {
    expect(targetFromExample('{"n": 1, "when": "2026-01-02"}').fields).toMatchObject([{ id: 'n', type: 'integer' }, { id: 'when', format: 'date' }]);
    expect(targetFromExample('{"n": 1}', { intAsNumber: true }).fields[0].type).toBe('number');
  });
  it('reads a column list with nesting and line items', () => {
    expect(targetFromColumns('id\ncustomer.email\nitems[].sku').fields.map((f) => f.id)).toEqual(['id', 'customer.email', 'items[]', 'items[].sku']);
  });
});

describe('recommendations', () => {
  it('asks which price instead of guessing', async () => {
    const r = await rec(orders(12), { price: { type: 'number' } });
    expect(r.fields[0].status).toBe('question');
    expect(r.fields[0].chosen).toBeNull(); // nothing under the bar is pre-selected
    expect(r.fields[0].question!.kind).toBe('close_call');
    // Four fields could be the price (amount is a synonym); the question shows the closest three.
    expect(r.fields[0].question!.options).toHaveLength(3);
  });
  it('asks cents or dollars when the values can\'t tell', async () => {
    const r = await rec(orders(12), { amount: { type: 'number' } });
    expect(r.fields[0].question?.kind).toBe('unit');
  });
  it('maps the obvious ones confidently, with the transform the target needs', async () => {
    const r = await rec(orders(12), { email: { type: 'string', format: 'email' }, created_at: { type: 'string', format: 'date-time' } });
    expect(r.fields.map((f) => [f.status, f.chosen?.sourceId])).toEqual([['confident', 'buyer.email_address'], ['confident', 'created']]);
    expect(r.fields[1].chosen!.mapping.transforms).toEqual([{ op: 'parse_date', from: 'epoch_s', out: 'date-time' }]);
    expect(r.fields[1].chosen!.score).toBeGreaterThanOrEqual(T);
  });
  it('says plainly when nothing fits', async () => {
    const r = await rec(orders(12), { phone_number: { type: 'string' } });
    expect(r.fields[0].status).toBe('no_source');
  });
  it('asks before turning a 20-digit id into a lossy number', async () => {
    const recs = Array.from({ length: 5 }, (_, i) => `{"id": ${12345678901234567890n + BigInt(i)}}`);
    const f = loadText('b', `[${recs.join(',')}]`);
    const r = await recommend(targetFromSchema('{"type":"object","properties":{"id":{"type":"integer"}}}'), profileRecords(f.records, f.bigIntPaths), f.records);
    expect(r.fields[0].question?.kind).toBe('big_integer');
  });
  it('treats thin samples as questions', async () => {
    const r = await rec(orders(2), { email: { type: 'string', format: 'email' } });
    expect(r.fields[0]).toMatchObject({ status: 'question', question: { kind: 'thin' } });
  });
});

describe('grammar', () => {
  it('rejects anything outside it', () => {
    expect(checkGrammar({ target: ['a'], source: { op: 'eval', code: 'x' } }).ok).toBe(false);
    expect(checkGrammar({ target: ['a'], source: { op: 'path', path: ['a'] }, transforms: [{ op: 'scale', power: 0.5 }] }).ok).toBe(false);
    expect(checkGrammar({ target: ['a'], source: { op: 'path', path: ['a'] }, transforms: Array(5).fill({ op: 'trim' }) }).ok).toBe(false);
    expect(checkGrammar({ target: ['a'], source: { op: 'nested', array: ['x'], fields: [{ target: ['b'], source: { op: 'nested', array: ['y'], fields: [] } }] } }).ok).toBe(false);
  });
});

describe('fieldmap.yml', () => {
  it('round-trips to byte-identical transform text', () => {
    const fields = [{ target: 'email', mapping: { target: ['email'], source: { op: 'path' as const, path: ['buyer', 'email_address'] }, transforms: [{ op: 'lower' as const }] }, score: 90, proposed_by: 'rule' as const }];
    const text = writeFieldMap({ field_map: 1, tool_version: TOOL_VERSION, jsonata_version: JSONATA_VERSION, target: { kind: 'schema', hash: 'x' }, samples: { records: 1, hash: 'y' }, thresholds: { T: 60, G: 10 }, fields });
    expect(compileJsonata(mappingsOf(readFieldMap(text)))).toBe(compileJsonata(fields.map((f) => f.mapping)));
  });
  it('refuses a file from another jsonata version', () => {
    expect(() => readFieldMap('field_map: 1\njsonata_version: 2.0.0\nfields: []\n')).toThrow(/jsonata 2.0.0/);
  });
});

describe('model drafts', () => {
  it('masks high-cardinality values, passes categorical ones, and never sends emails', async () => {
    const f = loadText('t', JSON.stringify(orders(12)));
    const profile = profileRecords(f.records);
    const target = targetFromSchema('{"type":"object","properties":{"price":{"type":"number"},"email":{"type":"string"}}}');
    const r = await recommend(target, profile, f.records);
    const p = buildPayload(target, profile, r.fields);
    const email = p.source_paths.find((x) => x.id === 'buyer.email_address')!;
    expect(email.examples_masked).toBe(true);
    expect(email.examples[0]).toBe(maskValue('p0@example.com'));
    expect(p.source_paths.find((x) => x.id === 'buyer.first_name')!.examples[0]).toBe('Ada');
  });
  it('accepts only grammar answers on real paths, and scores them like any other', async () => {
    const f = loadText('t', JSON.stringify(orders(12)));
    const profile = profileRecords(f.records);
    const target = targetFromSchema('{"type":"object","properties":{"price":{"type":"number"},"email":{"type":"string"}}}');
    const res = await acceptDrafts({ fields: [
      { target: 'price', source: { op: 'path', path: ['sale_price'] } },
      { target: 'email', source: { op: 'path', path: ['buyer', 'mail'] } },
      { target: 'nope', source: { op: 'path', path: ['id'] } },
      { target: 'price', source: { op: 'sql', q: 'select 1' } },
    ] }, target, profile, f.records, () => null);
    expect(res.accepted.map((a) => [a.target, a.candidate.sourceId])).toEqual([['price', 'sale_price']]);
    expect(res.rejected.map((r) => r.target)).toEqual(['email', 'nope', 'price']);
    expect(res.accepted[0].candidate.score).toBeGreaterThan(0);
  });
});
