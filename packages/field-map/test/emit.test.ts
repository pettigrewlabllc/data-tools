import { describe, expect, it } from 'vitest';
import { compileJsonata } from '../src/engine/emit-jsonata';
import { compilePython } from '../src/engine/emit-python';
import { runAll } from '../src/engine/run';
import { firstDifference } from '../src/engine/canonical';
import type { FieldMapping } from '../src/engine/grammar';
import type { Json } from '../src/engine/json';
import { PYTHON, runPython } from './helpers';

const f = (target: string, source: FieldMapping['source'], transforms: FieldMapping['transforms'] = []): FieldMapping => ({ target: target.split('.'), source, transforms });
const p = (s: string) => s.split('.');

// Every op on the inputs that break naive emitters: nulls, missing, one-item arrays, empty arrays, bad numbers,
// dates without offsets, impossible dates, big integers read as strings, booleans next to 1 and 0.
const RECORDS: Json[] = [
  { id: 7, big: '12345678901234567890', c: { email: ' A@X.com ' }, ts: 1731600000, tms: '1731600000123', tus: 1731600000123456, tns: '1731600000123456789',
    when: '2026-11-14T10:00:00', d2: '2026-02-31', us: '1/4/2026', first: 'Ada', last: null, price: 1999, n: 'abc', b: 'Yes', code: 'CA',
    items: [{ sku: 'A', qty: '2', price: 0.1 }, { sku: 'B', qty: 'x', price: 0.2 }], tags: ['q'], flag: true, f: 0.1 },
  { id: 8, items: { sku: 'C', qty: 1 }, ts: '1731600000', n: '12.5', b: 0, price: 5, when: '2026-11-14 10:00:00.5+02:00', first: null, last: 'Lovelace', tags: [], code: 'ZZ', flag: 1, f: 1e-7 },
  { id: 9, n: ' -3 ', b: 'nope', price: null, when: '2026-11-14T25:00:00Z', items: [], c: null, tags: 'solo', flag: 'true', f: 123456789.123456789 },
  { id: null, n: 1e21, ts: 4102444800000, items: [{ sku: null }], f: 2.5e-5 },
];

const MAPPINGS: FieldMapping[] = [
  f('id', { op: 'path', path: p('id') }, [{ op: 'cast', to: 'string' }]),
  f('big', { op: 'path', path: p('big') }, [{ op: 'cast', to: 'string' }]),
  f('big_int', { op: 'path', path: p('big') }, [{ op: 'cast', to: 'integer' }]),
  f('contact.email', { op: 'path', path: p('c.email') }, [{ op: 'trim' }, { op: 'lower' }]),
  f('at', { op: 'path', path: p('ts') }, [{ op: 'parse_date', from: 'epoch_s', out: 'date-time' }]),
  f('at_ms', { op: 'path', path: p('tms') }, [{ op: 'parse_date', from: 'epoch_ms', out: 'date-time' }]),
  f('at_us', { op: 'path', path: p('tus') }, [{ op: 'parse_date', from: 'epoch_us', out: 'date-time' }]),
  f('at_ns', { op: 'path', path: p('tns') }, [{ op: 'parse_date', from: 'epoch_ns', out: 'date' }]),
  f('when', { op: 'path', path: p('when') }, [{ op: 'parse_date', from: 'iso', out: 'date-time' }]),
  f('bad', { op: 'path', path: p('d2') }, [{ op: 'parse_date', from: 'iso', out: 'date' }]),
  f('usd', { op: 'path', path: p('us') }, [{ op: 'parse_date', from: 'us_date', out: 'date' }]),
  f('name', { op: 'concat', paths: [p('first'), p('last')], sep: ' ' }),
  f('either', { op: 'coalesce', paths: [p('last'), p('first')] }, [{ op: 'upper' }]),
  f('dollars', { op: 'path', path: p('price') }, [{ op: 'scale', power: -2 }]),
  f('thousands', { op: 'path', path: p('price') }, [{ op: 'scale', power: 3 }]),
  f('n', { op: 'path', path: p('n') }, [{ op: 'cast', to: 'number' }]),
  f('n_int', { op: 'path', path: p('n') }, [{ op: 'cast', to: 'integer' }]),
  f('f_str', { op: 'path', path: p('f') }, [{ op: 'cast', to: 'string' }]),
  f('b', { op: 'path', path: p('b') }, [{ op: 'cast', to: 'boolean' }]),
  f('flag', { op: 'path', path: p('flag') }, [{ op: 'cast', to: 'boolean' }]),
  f('state', { op: 'path', path: p('code') }, [{ op: 'value_map', map: { CA: 'California', NY: 'New York' } }]),
  f('tags', { op: 'values', array: p('tags'), field: [] }),
  f('tags_up', { op: 'values', array: p('tags'), field: [] }, [{ op: 'upper' }]),
  f('skus', { op: 'values', array: p('items'), field: p('sku') }),
  f('nitems', { op: 'count', array: p('items') }),
  f('qty_b', { op: 'pick', array: p('items'), which: { key: p('sku'), equals: 'B' }, field: p('qty') }),
  f('first_sku', { op: 'pick', array: p('items'), which: 'first', field: p('sku') }),
  f('last_sku', { op: 'pick', array: p('items'), which: 'last', field: p('sku') }),
  f('src', { op: 'constant', value: 'vendor-a' }),
  { target: ['lines'], transforms: [], source: { op: 'nested', array: p('items'), fields: [
    f('sku', { op: 'path', path: p('sku') }, [{ op: 'lower' }]),
    f('qty', { op: 'path', path: p('qty') }, [{ op: 'cast', to: 'integer' }]),
    f('price', { op: 'path', path: p('price') }),
  ] } },
];

describe('JSONata emitter', () => {
  it('meets the grammar semantics', async () => {
    const [a, b, c, d] = await runAll(compileJsonata(MAPPINGS), RECORDS) as Record<string, Json>[];
    expect(a).toMatchObject({ id: '7', big: '12345678901234567890', contact: { email: 'a@x.com' }, at: '2024-11-14T16:00:00.000Z', at_ms: '2024-11-14T16:00:00.123Z', at_us: '2024-11-14T16:00:00.123Z', at_ns: '2024-11-14',
      when: '2026-11-14T10:00:00.000Z', usd: '2026-01-04', name: 'Ada', dollars: 19.99, b: true, flag: true, state: 'California', tags: ['q'], skus: ['A', 'B'], nitems: 2, qty_b: 'x', first_sku: 'A', last_sku: 'B', f_str: '0.1',
      lines: [{ sku: 'a', qty: 2, price: 0.1 }, { sku: 'b', price: 0.2 }] });
    expect(a.big_int).toBeUndefined(); // a 20-digit id never becomes a lossy number
    expect(a.bad).toBeUndefined(); // February 31st is missing, not March 3rd
    expect(a.n).toBeUndefined(); // "abc" is missing, not an error that aborts the record
    expect(b).toMatchObject({ when: '2026-11-14T08:00:00.500Z', name: 'Lovelace', either: 'LOVELACE', n: 12.5, b: false, flag: true, tags: [], skus: ['C'], nitems: 1, lines: [{ sku: 'c', qty: 1 }], f_str: '1e-7' });
    expect(b.state).toBeUndefined();
    expect(c).toMatchObject({ n: -3, n_int: -3, tags: ['solo'], nitems: 0, lines: [] });
    expect(c.when).toBeUndefined();
    expect(c.contact).toBeUndefined(); // an object whose fields are all missing is missing
    expect(c.flag).toBe(true); // the text "true" casts to a boolean
    expect(d.id).toBeUndefined();
    expect(d.at).toBeUndefined(); // an epoch in ms read as seconds lands past year 9999: missing
    expect(d.lines).toEqual([]);
    expect(d.f_str).toBe('0.000025');
  });

  it('gives byte-identical text for the same mapping', () => {
    expect(compileJsonata(MAPPINGS)).toBe(compileJsonata(structuredClone(MAPPINGS)));
  });
});

describe.skipIf(!PYTHON)('Python emitter (FM_PYTHON)', () => {
  it('matches JSONata in canonical form on every record', async () => {
    const js = await runAll(compileJsonata(MAPPINGS), RECORDS);
    const pyOut = runPython(compilePython(MAPPINGS), RECORDS);
    const jsKept = js.filter((x) => x !== undefined);
    expect(pyOut.length).toBe(jsKept.length);
    jsKept.forEach((x, i) => expect(firstDifference(x, pyOut[i]), `record ${i}`).toBeNull());
  });
});
