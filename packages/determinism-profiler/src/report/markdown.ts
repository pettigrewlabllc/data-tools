import type { Report } from '../types.js';
import { sections } from './sections.js';

const esc = (s: string) => s.replace(/([\\`*_[\]<>|])/g, '\\$1');

/** Made to paste into a PR description or comment. */
export function renderMarkdown(r: Report): string {
  const { headline, sections: secs } = sections(r);
  const out = [`## Determinism Profiler · ${esc(r.input.name)}`, '', `**${esc(headline)}**`, ''];
  for (const s of secs) {
    out.push(`### ${s.title}`, '');
    if (s.lede) out.push(esc(s.lede), '');
    for (const it of s.items) {
      out.push(`- **${esc(it.head)}**`);
      for (const l of it.lines) out.push(`  - ${esc(l)}`);
    }
    out.push('');
  }
  out.push(`<sub>determinism-profiler ${r.tool_version} · ${r.static_only ? 'static check' : `${r.runs} runs`} · hashes only, no data values</sub>`, '');
  return out.join('\n');
}
