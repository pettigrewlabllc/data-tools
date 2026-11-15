import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { profile, writeOutputs } from '../src/profile.js';
import { renderHtml } from '../src/report/html.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { sections } from '../src/report/sections.js';
import { renderTerminal } from '../src/report/terminal.js';
import { DBT, FIX, JUPYTER, PKG } from './helpers.js';

// Values planted in fixture data and in SQL/code literals. None may reach a trace or a report (D1).
const CANARIES = ['CANARY_7f3a', '987654.321', 'initech', 'globex', 'umbrella'];

function scanOut(dir: string): string[] {
  const hits: string[] = [];
  for (const f of readdirSync(dir)) {
    const body = readFileSync(join(dir, f), 'utf8');
    for (const c of CANARIES) if (body.includes(c)) hits.push(`${f}: ${c}`);
  }
  return hits;
}

async function runAndScan(input: string, opts = {}) {
  const { report, traces } = await profile(input, { runs: 2, jupyter: JUPYTER, dbt: DBT, ...opts });
  const out = mkdtempSync(join(tmpdir(), 'dp-test-'));
  writeOutputs(out, report, traces);
  return { report, hits: scanOut(out) };
}

describe('traces and reports hold no data values (D1)', () => {
  it('SQL, including a failing CAST of a canary value', async () => {
    const { report, hits } = await runAndScan(join(FIX, 'sql-clean'));
    expect(report.score.percent).toBe(100);
    expect(hits).toEqual([]);
  });
  it.skipIf(!JUPYTER)('notebook, including a cell that errors on a canary value', async () => {
    const { report, hits } = await runAndScan(join(FIX, 'nb-clean/analysis.ipynb'));
    expect(report.score.percent).toBe(100);
    expect(hits).toEqual([]);
  });
  it.skipIf(!DBT)('dbt project with a canary in a seed', async () => {
    const { hits } = await runAndScan(join(FIX, 'dbt-duckdb'));
    expect(hits).toEqual([]);
  });
});

describe('--show-changed-rows keeps key values out of every file (D1)', () => {
  it('SQL: the canary key prints to the terminal and appears in no trace or report', async () => {
    const out = mkdtempSync(join(tmpdir(), 'dp-cr-'));
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(PKG, 'src/cli.ts'), join(FIX, 'sql-changed-rows'), '--show-changed-rows', '--fail-on', 'never', '--out', out], { encoding: 'utf8', cwd: PKG });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('keyed by customer');
    expect(r.stdout).toContain('CANARY_7f3a: different values');
    expect(r.stdout).toContain("there's no key to list rows by");
    expect(scanOut(out)).toEqual([]);
  });
  it('the profile result carries the rows; writeOutputs never sees them', async () => {
    const { report, traces, changedRows } = await profile(join(FIX, 'sql-changed-rows'), { runs: 2, showChangedRows: true });
    expect(JSON.stringify(changedRows)).toContain('CANARY_7f3a');
    const out = mkdtempSync(join(tmpdir(), 'dp-cr2-'));
    writeOutputs(out, report, traces);
    expect(scanOut(out)).toEqual([]);
    expect(traces[0].params.show_changed_rows).toBe(true);
  });
  it.skipIf(!DBT)('dbt: changed keys print, files stay clean', async () => {
    const { report, traces, changedRows } = await profile(join(FIX, 'dbt-duckdb'), { runs: 2, dbt: DBT, showChangedRows: true });
    const listed = (changedRows as { key?: string }[]).filter((x) => x.key);
    expect(listed.map((x) => x.key)).toContain('order_id');
    const out = mkdtempSync(join(tmpdir(), 'dp-cr3-'));
    writeOutputs(out, report, traces);
    expect(scanOut(out)).toEqual([]);
  });
});

describe('notebook masks (volatile printed output)', () => {
  it.skipIf(!JUPYTER)('a printed timestamp is "same" with masks and "values" without, and the mask is counted', async () => {
    const nb = join(FIX, 'nb-timestamp-print/analysis.ipynb');
    const masked = await profile(nb, { runs: 2, jupyter: JUPYTER });
    const cell3 = masked.report.steps.find((s) => s.step_id === 'cell-3')!;
    expect(cell3.verdict).toBe('same');
    expect(cell3.masked).toEqual({ timestamp: 1 });
    expect(renderMarkdown(masked.report)).toContain('Ignored in printed output: 1 timestamp.');
    const raw = await profile(nb, { runs: 2, jupyter: JUPYTER, defaultMasks: false });
    expect(raw.report.steps.find((s) => s.step_id === 'cell-3')!.verdict).toBe('values');
  });
  it.skipIf(!JUPYTER)('a --sanitize file adds its own masks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dp-san-'));
    const file = join(dir, 'sanitize.cfg');
    writeFileSync(file, '[total line]\nregex: total=[0-9.]+\nreplace: total=X\n');
    const r = await profile(join(FIX, 'nb-timestamp-print/analysis.ipynb'), { runs: 2, jupyter: JUPYTER, sanitize: file });
    expect(r.report.steps.find((s) => s.step_id === 'cell-3')!.masked).toEqual({ timestamp: 1, 'total line': 1 });
  });
});

describe('report (D6)', () => {
  it('terminal, Markdown and HTML carry the same content', async () => {
    const { report } = await profile(join(FIX, 'sql-ties'), { runs: 2 });
    const t = renderTerminal(report);
    const md = renderMarkdown(report).replace(/\\(.)/g, '$1');
    const html = renderHtml(report).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const { headline, sections: secs } = sections(report);
    const all = [headline, ...secs.flatMap((s) => [s.title, s.lede, ...s.items.flatMap((i) => [i.head, ...i.lines])])].filter(Boolean);
    expect(all.length).toBeGreaterThan(8);
    for (const s of all) {
      expect(t).toContain(s);
      expect(md).toContain(s);
      expect(html).toContain(s);
    }
  });
  it('the HTML makes no network requests', async () => {
    const { report } = await profile(join(FIX, 'sql-clean'), { runs: 2 });
    expect(renderHtml(report)).not.toMatch(/(src|href)=["']?https?:/);
  });
});

describe('subset runs (D7)', () => {
  it('SQL --select profiles the step and what it reads from', async () => {
    const { report } = await profile(join(FIX, 'sql-sample'), { runs: 2, select: ['03_summary'] });
    expect(report.steps.map((s) => s.step_id).sort()).toEqual(['01_events.sql:1', '02_sampled.sql:2', '03_summary.sql:1']);
  });
  it.skipIf(!JUPYTER)('notebook --cells pulls in the cells it needs', async () => {
    const { report } = await profile(join(FIX, 'nb-sample/analysis.ipynb'), { runs: 2, jupyter: JUPYTER, cells: '3' });
    expect(report.steps.map((s) => s.step_id)).toEqual(['cell-1', 'cell-2', 'cell-3']);
    expect(report.steps.find((s) => s.step_id === 'cell-2')?.attribution).toBe('origin');
    expect(report.notes.join(' ')).toContain('cell 3, plus cells 1 and 2');
  });
  it.skipIf(!JUPYTER)('a seed cell that stores nothing is kept in a subset', async () => {
    const { report } = await profile(join(FIX, 'nb-clean/analysis.ipynb'), { runs: 2, jupyter: JUPYTER, cells: '3' });
    expect(report.score.percent).toBe(100);
  });
});

describe('CLI', () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', join(PKG, 'src/cli.ts'), ...args, '--quiet', '--out', mkdtempSync(join(tmpdir(), 'dp-cli-'))], { encoding: 'utf8', cwd: PKG });
  it('exits 0 when every step matched, 1 when one differed, 0 with --fail-on never', () => {
    expect(cli(join(FIX, 'sql-clean')).status).toBe(0);
    expect(cli(join(FIX, 'sql-sample')).status).toBe(1);
    expect(cli(join(FIX, 'sql-sample'), '--fail-on', 'never').status).toBe(0);
  });
  it('exits 2 with a clear message for bad input or a missing tool', () => {
    const a = cli(join(FIX, 'does-not-exist'));
    expect(a.status).toBe(2);
    expect(a.stderr).toContain("There's nothing at");
    const b = cli(join(FIX, 'nb-sample/analysis.ipynb'), '--jupyter', '/nope/jupyter');
    expect(b.status).toBe(2);
    expect(b.stderr).toContain("Couldn't find jupyter");
    expect(cli(join(FIX, 'sql-clean'), '--runs', '1').status).toBe(2);
  });
  it('--static-only reads the code and runs nothing', () => {
    const r = cli(join(FIX, 'sql-sample'), '--static-only');
    expect(r.status).toBe(0);
  });
});
