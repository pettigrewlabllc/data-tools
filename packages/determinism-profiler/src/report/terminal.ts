import type { ChangedRowsResult } from '../changed-rows.js';
import { CHANGED_ROWS as W } from './words.js';
import type { Report } from '../types.js';
import { sections } from './sections.js';

const TONE: Record<string, string> = { origin: '31', inherited: '33', inconclusive: '33', latent: '36', candidate: '2', judgment: '35', same: '32', notes: '2', static: '31' };

export function renderTerminal(r: Report, color = false): string {
  const c = (code: string, s: string) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
  const { headline, sections: secs } = sections(r);
  const lines = ['', c('1', `Determinism Profiler · ${r.input.name}${r.static_only ? '' : ` · ${r.runs} runs`}`), headline, ''];
  for (const s of secs) {
    lines.push(c(`1;${TONE[s.key] ?? '0'}`, s.title));
    if (s.lede) lines.push(c('2', s.lede));
    for (const it of s.items) {
      lines.push(`  ${s.key === 'same' ? '✓' : '•'} ${it.head}`);
      for (const l of it.lines) lines.push(`      ${l}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}


/** The --show-changed-rows section. Printed only; nothing else ever renders it. */
export function renderChangedRows(res: ChangedRowsResult[] | 'not_supported', color = false): string {
  const c = (code: string, s: string) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
  const lines = [c('1;35', W.title)];
  if (res === 'not_supported') return [...lines, W.notSupported, ''].join('\n');
  lines.push(c('2', W.lede));
  if (!res.length) lines.push(`  ${W.none}`);
  for (const r of res) {
    if ('skipped' in r) {
      lines.push(`  • ${r.label}`, `      ${r.skipped === 'no_key' ? W.noKey : W.notKept}`);
      continue;
    }
    lines.push(`  • ${W.head(r.label, r.key, r.runA, r.runB)}`);
    for (const row of r.rows) {
      const what = row.change === 'only_a' ? W.change.only_a(r.runA) : row.change === 'only_b' ? W.change.only_b(r.runB) : W.change.changed();
      lines.push(`      ${row.key}: ${what}`);
    }
    if (r.more) lines.push(`      ${W.more}`);
  }
  return [...lines, ''].join('\n');
}
