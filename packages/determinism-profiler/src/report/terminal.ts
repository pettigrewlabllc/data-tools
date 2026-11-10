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
