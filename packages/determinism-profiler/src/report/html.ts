import type { Report } from '../types.js';
import { sections } from './sections.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** One static file, no network requests. The look is a plain default until Joel picks one. */
export function renderHtml(r: Report): string {
  const { headline, sections: secs } = sections(r);
  const body = secs.map((s) => `
    <section class="s-${s.key}">
      <h2>${esc(s.title)}</h2>
      ${s.lede ? `<p class="lede">${esc(s.lede)}</p>` : ''}
      <ul>${s.items.map((it) => `<li><strong>${esc(it.head)}</strong>${it.lines.length ? `<ul>${it.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>
    </section>`).join('');
  const pct = r.static_only ? '' : `<div class="score" aria-label="score">${r.score.percent}%</div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Determinism report · ${esc(r.input.name)}</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6a65;--line:#e4e2dc;--origin:#b42318;--inherited:#a15c07;--latent:#0e7490;--same:#15803d;--judgment:#7c3aed}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--muted:#a3a29c;--line:#2d2c29;--origin:#f87171;--inherited:#fbbf24;--latent:#67e8f9;--same:#4ade80;--judgment:#c4b5fd}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}
header{display:flex;gap:20px;align-items:center;border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:8px}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--muted);margin:0}.score{font:600 40px/1 ui-monospace,Menlo,monospace;min-width:4ch;text-align:right;margin-left:auto}
h2{font-size:16px;margin:28px 0 4px}.lede{color:var(--muted);margin:0 0 8px}
ul{margin:0;padding-left:18px}li{margin:6px 0}li ul li{margin:2px 0;color:var(--muted);font-size:14px}strong{font-weight:600;font-family:ui-monospace,Menlo,monospace;font-size:13.5px;word-break:break-word}
.s-origin h2{color:var(--origin)}.s-static h2{color:var(--origin)}.s-inherited h2,.s-inconclusive h2{color:var(--inherited)}.s-latent h2{color:var(--latent)}.s-same h2{color:var(--same)}.s-judgment h2{color:var(--judgment)}
footer{color:var(--muted);font-size:13px;margin-top:40px;border-top:1px solid var(--line);padding-top:12px}
</style></head><body><main>
<header><div><h1>${esc(r.input.name)}</h1><p class="sub">${esc(headline)}</p></div>${pct}</header>
${body}
<footer>determinism-profiler ${esc(r.tool_version)} · ${r.static_only ? 'static check' : `${r.runs} runs`} · ${esc(r.generated_at)} · hashes only, no data values</footer>
</main>
<script type="application/json" id="report">${JSON.stringify(r).replace(/</g, '\\u003c')}</script>
</body></html>
`;
}
