import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createNodeDb } from '@data-tools/core-node';
import {
  loadFile, profileTable, candidatesForPair, buildReceipt, describePattern, emitPython, emitSqlScript, mappingTable, dropDominatedLookups,
  TOOL, TOOL_VERSION, type MappingJoin, type Plan, type TableProfile, type JoinCandidate,
} from '../src';

const PY = process.env.JR_PYTHON ?? '';
const FILES = fileURLToPath(new URL('../../../fixtures/join-receipt/real/files/', import.meta.url));

// BLS LAUS (Excel, title row, footnotes) against Census population estimates (Latin-1 CSV with state total rows).
describe('real public files', () => {
  it('BLS Excel × Census Latin-1 CSV: the right two-column key, Puerto Rico explained, exports reproduce the receipt', async () => {
    const db = await createNodeDb();
    const taken = new Set<string>();
    const profiles: TableProfile[] = [];
    const copies = new Map<string, string>();
    for (const f of ['bls_laus_county_2024.xlsx', 'census_popest_county_2024.csv']) {
      const r = await loadFile(db, f, new Uint8Array(readFileSync(join(FILES, f))), taken);
      if (!r.ok) throw new Error(r.error);
      if (r.copy) copies.set(r.copy.file, r.copy.text);
      const p = await profileTable(db, r.name, r.file);
      profiles.push({ ...p, ...(r.sheet && r.copy ? { sheet: r.sheet, readFrom: r.copy.file } : {}), ...(r.encoding ? { encoding: r.encoding } : {}) });
    }
    expect(profiles[1].encoding).toBe('windows-1252');
    const top = (await candidatesForPair(db, profiles[0], profiles[1])).best[0];
    const cols = [top.left.column, ...(top.also ?? []).map((p) => p.left.column)].sort();
    expect(cols).toEqual(['County FIPS Code', 'State FIPS Code']);

    const plan: Plan = { join: { op: 'join_on', how: 'left', left: top.left, right: top.right, ...(top.also ? { also: top.also } : {}) } };
    const r = await buildReceipt(db, profiles, plan);
    expect(r.unmatchedLeft).toBe(78);
    expect(r.patternsLeft.map(describePattern)).toContain('All 78 unmatched rows have State FIPS Code = 72 (72 is 2% of the file).');
    expect(r.fanoutWarning).toBe(false);

    const j: MappingJoin = {
      id: 'laus__popest', left: plan.join.left, right: plan.join.right, how: 'left', also: plan.join.also,
      aggregate_left: null, aggregate_right: null, status: 'approved', proposed_by: 'rule', llm: null,
      receipt: { matched: r.matchedLeft, unmatched_left: r.unmatchedLeft, unmatched_right: r.unmatchedRight, joined_rows: r.joinedRows, fanout: r.fanout, max_per_key_right: r.maxPerKeyRight },
    };
    const m = { tool: TOOL, version: TOOL_VERSION, tables: profiles.map(mappingTable), joins: [j] };
    const dir = mkdtempSync(join(tmpdir(), 'jr-real-'));
    copyFileSync(join(FILES, 'census_popest_county_2024.csv'), join(dir, 'census_popest_county_2024.csv'));
    writeFileSync(join(dir, 'bls_laus_county_2024.xlsx.csv'), copies.get('bls_laus_county_2024.xlsx.csv')!);

    const sql = emitSqlScript(m);
    expect(sql).toContain("encoding='latin-1'");
    const stmt = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n')
      .replace(/'(bls_laus_county_2024\.xlsx\.csv|census_popest_county_2024\.csv)'/g, (_, f) => `'${join(dir, f)}'`);
    expect((await (await createNodeDb()).query(stmt.trim().replace(/;$/, ''))).length).toBe(r.joinedRows);

    if (!PY || !existsSync(PY)) return;
    writeFileSync(join(dir, 'join.py'), emitPython(m));
    execFileSync(PY, ['join.py'], { cwd: dir });
  }, 60_000);

  it('a lookup key loses to a direct column that matches as much', () => {
    const f = (overlap: number) => ({ containLeft: 1, containRight: 1, overlap, leftUnique: true, rightUnique: false, formatMatch: true, nameSim: 1, minDistinct: 50, bothRowNumbers: false });
    const lookup: JoinCandidate = { left: { table: 'a', column: 'STATE', transforms: [{ op: 'crosswalk', table: 'us_state', from: 'abbr', to: 'fips' }] }, right: { table: 'b', column: 'STATE', transforms: [] }, features: f(51), score: 96, reason: '' };
    const direct: JoinCandidate = { left: { table: 'a', column: 'STATEFP', transforms: [] }, right: { table: 'b', column: 'STATE', transforms: [] }, features: f(51), score: 85, reason: '' };
    const found = [lookup, direct];
    dropDominatedLookups(found);
    expect(found).toEqual([direct]);
    const onlyLookup = [{ ...lookup }, { ...direct, features: f(10) }];
    dropDominatedLookups(onlyLookup);
    expect(onlyLookup.length).toBe(2); // the lookup finds more, so it stays
  });
});
