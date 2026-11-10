import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createNodeDb } from '@data-tools/core-node';
import {
  loadFile, profileTable, findTable, findCandidates, buildReceipt, emitPython, emitSqlScript, mappingTable,
  TOOL, TOOL_VERSION, type MappingJoin, type Plan, type TableProfile,
} from '../src';
import { enc, csv } from './helpers';

const PY = process.env.JR_PYTHON ?? '';
// Built by test/data/make_xlsx.py: a notes sheet first, two title rows, the header on row 4, footnotes below.
const XLSX = new Uint8Array(readFileSync(new URL('./data/laus_style.xlsx', import.meta.url)));
const COUNTIES = csv('state_fips,county_fips,name', [['01', '001', 'Autauga'], ['01', '003', 'Baldwin'], ['06', '001', 'Alameda'], ['06', '037', 'Los Angeles'], ['48', '201', 'Harris'], ['48', '001', 'Anderson']]);

async function loadBoth() {
  const db = await createNodeDb();
  const taken = new Set<string>();
  const profiles: TableProfile[] = [];
  const copies = new Map<string, string>();
  for (const [file, bytes] of [['counties.csv', enc(COUNTIES)], ['laus_style.xlsx', XLSX]] as const) {
    const r = await loadFile(db, file, bytes, taken);
    if (!r.ok) throw new Error(r.error);
    const p = await profileTable(db, r.name, r.file);
    if (r.copy) copies.set(r.copy.file, r.copy.text);
    profiles.push(r.sheet && r.copy ? { ...p, sheet: r.sheet, readFrom: r.copy.file } : p);
  }
  return { db, profiles, copies };
}

describe('Excel', () => {
  it('finds the table under the title rows and drops the footnotes', async () => {
    const db = await createNodeDb();
    const r = await loadFile(db, 'laus_style.xlsx', XLSX, new Set());
    expect(r).toMatchObject({ ok: true, rows: 5, sheet: { sheet: 'Data', sheetCount: 2, headerRow: 4, lastRow: 9, width: 6 } });
    const rows = await db.query('SELECT "State FIPS Code" AS s, "County FIPS Code" AS c, "Released" AS d FROM laus_style ORDER BY 1, 2');
    expect(rows[0]).toEqual({ s: '01', c: '001', d: '2025-04-18' }); // leading zeros and dates survive
  });

  it('findTable ignores short rows above and below', () => {
    const t = findTable([['Title'], [null], ['a', 'b', 'c'], [1, 2, 3], [4, 5, null], ['note'], [null]]);
    expect(t).toEqual({ header: 3, last: 5, width: 3 });
    expect(findTable([['just one column'], ['x']])).toBeNull();
  });

  it('refuses the old .xls format with a reason', async () => {
    const r = await loadFile(await createNodeDb(), 'old.xls', new Uint8Array([1, 2, 3]), new Set());
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('.xlsx') });
  });

  it('joins on state × county codes, and the exports read the CSV copy', async () => {
    const { db, profiles, copies } = await loadBoth();
    const { pairs } = await findCandidates(db, profiles);
    const top = pairs[0].best[0];
    const cols = [top.left.column, ...(top.also ?? []).map((p) => p.left.column)].sort();
    expect(cols).toEqual(['county_fips', 'state_fips']);
    const plan: Plan = { join: { op: 'join_on', how: 'left', left: top.left, right: top.right, ...(top.also ? { also: top.also } : {}) } };
    const r = await buildReceipt(db, profiles, plan);
    expect(r.matchedLeft).toBe(5);
    expect(r.unmatchedLeft).toBe(1);

    const j: MappingJoin = {
      id: 'counties__laus', left: plan.join.left, right: plan.join.right, how: 'left', also: plan.join.also,
      aggregate_left: null, aggregate_right: null, status: 'approved', proposed_by: 'rule', llm: null,
      receipt: { matched: r.matchedLeft, unmatched_left: r.unmatchedLeft, unmatched_right: r.unmatchedRight, joined_rows: r.joinedRows, fanout: r.fanout, max_per_key_right: r.maxPerKeyRight },
    };
    const m = { tool: TOOL, version: TOOL_VERSION, tables: profiles.map(mappingTable), joins: [j] };
    expect(m.tables[1]).toMatchObject({ file: 'laus_style.xlsx', read_from: 'laus_style.xlsx.csv', sheet: { name: 'Data', header_row: 4, last_row: 9 } });
    const sql = emitSqlScript(m), py = emitPython(m);
    expect(sql).toContain("read_csv_auto('laus_style.xlsx.csv'");
    expect(py).toContain('pd.read_csv("laus_style.xlsx.csv"');

    // The SQL script, run by DuckDB on the copy, gives the receipt's row count.
    const dir = mkdtempSync(join(tmpdir(), 'jr-xlsx-'));
    writeFileSync(join(dir, 'counties.csv'), COUNTIES);
    writeFileSync(join(dir, 'laus_style.xlsx.csv'), copies.get('laus_style.xlsx.csv')!);
    const sdb = await createNodeDb();
    const stmt = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n').replace(/'(counties\.csv|laus_style\.xlsx\.csv)'/g, (_, f) => `'${join(dir, f)}'`);
    const out = await sdb.query(stmt.trim().replace(/;$/, ''));
    expect(out.length).toBe(r.joinedRows);

    if (!PY || !existsSync(PY)) return;
    writeFileSync(join(dir, 'join.py'), py);
    execFileSync(PY, ['join.py'], { cwd: dir });
  });
});
