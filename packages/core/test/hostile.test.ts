import { describe, it, expect } from 'vitest';
import { createNodeDb } from '@data-tools/core-node';
import { loadFile, profileTable, raggedLine } from '../src';
import { enc } from './helpers';

// Files people actually upload. Each either loads correctly or fails with a reason a person can act on.
const loads: [string, Uint8Array, number, string[]][] = [
  ['bom.csv', new Uint8Array([0xef, 0xbb, 0xbf, ...enc('id,v\n1,2\n2,3\n3,4\n')]), 3, ['id', 'v']],
  ['crlf.csv', enc('id,v\r\n1,2\r\n2,3\r\n3,4\r\n'), 3, ['id', 'v']],
  ['semicolon.csv', enc('id;v\n1;2\n2;3\n3;4\n'), 3, ['id', 'v']],
  ['dupe_cols.csv', enc('id,id,v\n1,1,2\n2,2,3\n3,3,4\n'), 3, ['id', 'id_1', 'v']],
  ['quoted.csv', enc('"Customer ID","Full Name"\n"1","A, Jr."\n"2","B"\n"3","C"\n'), 3, ['Customer ID', 'Full Name']],
  ['accents.csv', enc('Código,Año\n01,2024\n02,2024\n03,2024\n'), 3, ['Código', 'Año']],
  ['one_col.csv', enc('id\n1\n2\n3\n'), 3, ['id']],
  ['Weird Name!!.CSV', enc('id,v\n1,2\n2,3\n3,4\n'), 3, ['id', 'v']],
];
const fails: [string, Uint8Array, RegExp][] = [
  ['empty.csv', new Uint8Array(), /the file is empty/],
  ['header_only.csv', enc('id,name\n'), /header but no rows/],
  ['ragged.csv', enc('id,v\n1,2\n2\n3,4,5\n'), /line 4 has 3 fields, but the header has 2|line 3 has 1 field, but the header has 2/],
  ['binary.csv', new Uint8Array(Array.from({ length: 500 }, (_, i) => (i * 37) % 256)), /doesn't look like a text table/],
  ['garbage.parquet', enc('not parquet'), /isn't a valid Parquet file/],
  ['bad.json', enc('{"a": 1,'), /isn't valid JSON/],
  ['fake.xlsx', enc('id,v\n1,2\n'), /\.xlsx|workbook/],
  ['old.xls', enc('x'), /old \.xls format/],
];

describe('hostile files', () => {
  for (const [file, bytes, rows, cols] of loads) {
    it(`loads ${file}`, async () => {
      const db = await createNodeDb();
      const r = await loadFile(db, file, bytes, new Set());
      expect(r).toMatchObject({ ok: true, rows });
      if (r.ok) expect((await profileTable(db, r.name, r.file)).columns.map((c) => c.name)).toEqual(cols);
    });
  }
  for (const [file, bytes, msg] of fails) {
    it(`refuses ${file} with a reason`, async () => {
      const r = await loadFile(await createNodeDb(), file, bytes, new Set());
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(msg);
        expect(r.error).not.toMatch(/\/var\/|\/tmp\/|join-receipt-/); // no temp paths
      }
    });
  }
  it('a short row loads, with a warning naming the line', async () => {
    const r = await loadFile(await createNodeDb(), 'short.csv', enc('id,v\n1,2\n2\n3,4\n'), new Set());
    expect(r).toMatchObject({ ok: true, rows: 3, warning: expect.stringContaining('Line 3 has 1 field and the header has 2') });
  });
  it('a failed load frees its table name', async () => {
    const db = await createNodeDb();
    const taken = new Set<string>();
    await loadFile(db, 'data.csv', enc('id,v\n'), taken);
    const r = await loadFile(db, 'data.csv', enc('id,v\n1,2\n2,3\n3,4\n'), taken);
    expect(r).toMatchObject({ ok: true, name: 'data' });
  });
  it('raggedLine respects quotes', () => {
    expect(raggedLine('a,b\n"x,y",1\n2,3\n')).toBeNull();
    expect(raggedLine('a,b\n1,2\n3,4,5\n')).toEqual({ line: 3, got: 3, want: 2 });
  });
});
