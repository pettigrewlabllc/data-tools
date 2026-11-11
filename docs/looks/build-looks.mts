/**
 * Three look options for the HTML report, rendered from a real report (MovieLens notebook).
 * Mockups for Joel to pick from; the shipped renderer is unchanged until he does.
 *   npx tsx docs/looks/build-looks.mts <out-dir-with-report.json-and-traces>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sections } from '../../packages/determinism-profiler/src/report/sections.ts';
import { identity } from '../../packages/determinism-profiler/src/fingerprint.ts';
import type { Report, Trace } from '../../packages/determinism-profiler/src/types.ts';

const src = process.argv[2];
const here = dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(readFileSync(join(src, 'report.json'), 'utf8')) as Report;
const traces = [1, 2, 3].map((i) => JSON.parse(readFileSync(join(src, `trace-run-${i}.json`), 'utf8')) as Trace);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Per step, per run: did this run's outputs match run 1's?
const sig = (t: Trace, id: string) => JSON.stringify(Object.entries(t.steps.find((s) => s.step_id === id)?.outputs ?? {}).map(([k, f]) => [k, identity(f)]).sort());
const strip = (id: string) => traces.map((t) => sig(t, id) === sig(traces[0], id));
const { headline, sections: secs } = sections(report);
const stepFor = (head: string) => report.steps.find((s) => head.startsWith(s.label + ' ·'));

function body(dot: (match: boolean, i: number) => string) {
  return secs.map((s) => `<section class="s-${s.key}"><h2>${esc(s.title)}</h2>${s.lede ? `<p class="lede">${esc(s.lede)}</p>` : ''}
    <ul>${s.items.map((it) => {
      const st = stepFor(it.head);
      const runs = st ? `<span class="runs" aria-label="runs">${strip(st.step_id).map(dot).join('')}</span>` : '';
      return `<li><div class="head">${runs}<strong>${esc(it.head)}</strong></div>${it.lines.length ? `<ul>${it.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</li>`;
    }).join('')}</ul></section>`).join('');
}
const page = (title: string, css: string, header: string, dot: (m: boolean, i: number) => string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${css}</style></head><body><main>${header}${body(dot)}</main></body></html>`;
const pct = report.score.percent;

// A: Lab notebook. Graph paper, ink, three run boxes ticked or crossed like a lab log.
const A = page('Look A · Lab notebook', `
:root{--paper:#fbfaf3;--grid:#dfe8ef;--ink:#1f3a5f;--red:#b3261e;--muted:#5b6b7d}
@media (prefers-color-scheme:dark){:root{--paper:#16202b;--grid:#1f2c3a;--ink:#d8e4f2;--red:#ff8a80;--muted:#93a4b8}}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--paper);background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:22px 22px;font:15px/1.55 ui-serif,Georgia,serif}
main{max-width:820px;margin:0 auto;padding:28px 16px 64px}
header{border-bottom:2px solid var(--ink);padding-bottom:14px;margin-bottom:6px;display:flex;gap:16px;align-items:flex-end}
h1{font:600 22px/1.2 ui-serif,Georgia,serif;margin:0}.sub{margin:4px 0 0;color:var(--muted)}
.score{margin-left:auto;font:700 34px/1 ui-monospace,Menlo,monospace;border:2px solid var(--ink);padding:6px 10px;transform:rotate(-2deg)}
h2{font:700 13px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;margin:26px 0 6px}
.s-origin h2{color:var(--red)}.lede{margin:0 0 8px;color:var(--muted);font-style:italic}
ul{list-style:none;margin:0;padding:0}li{margin:8px 0}li ul{padding-left:58px}li ul li{margin:2px 0;color:var(--muted);font-size:14px}
.head{display:flex;gap:10px;align-items:baseline}strong{font:600 13.5px ui-monospace,Menlo,monospace;word-break:break-word}
.runs{display:inline-flex;gap:3px;flex:none}.runs b{width:14px;height:14px;border:1.5px solid var(--ink);font:700 11px/11px ui-monospace,monospace;text-align:center}
.runs b.x{color:var(--red);border-color:var(--red)}`,
`<header><div><h1>${esc(report.input.name)}</h1><p class="sub">${esc(headline)}</p></div><div class="score">${pct}%</div></header>`,
(m) => `<b class="${m ? '' : 'x'}">${m ? '✓' : '✗'}</b>`);

// B: Seismograph. Dark, each step a line with three run marks; a mark that jumps off the line moved.
const B = page('Look B · Seismograph', `
:root{--bg:#0f1214;--fg:#e6e8e6;--muted:#8d9691;--line:#2a3130;--hot:#ff6b4a;--warm:#f5b84a;--ok:#5fd38d}
@media (prefers-color-scheme:light){:root{--bg:#f6f5f1;--fg:#171a19;--muted:#5f6763;--line:#d6d4cc;--hot:#c2410c;--warm:#a16207;--ok:#15803d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,"SF Mono",Menlo,monospace}
main{max-width:880px;margin:0 auto;padding:28px 16px 64px}
header{display:grid;grid-template-columns:1fr auto;gap:6px 16px;align-items:end;border-bottom:1px solid var(--line);padding-bottom:16px}
h1{font-size:18px;margin:0}.sub{grid-column:1;margin:0;color:var(--muted);font-family:ui-sans-serif,system-ui,sans-serif}
.score{grid-row:1/3;grid-column:2;font-size:44px;font-weight:700;color:var(--warm)}
h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:28px 0 4px;color:var(--muted)}.s-origin h2{color:var(--hot)}.s-same h2{color:var(--ok)}
.lede{margin:0 0 10px;color:var(--muted);font-family:ui-sans-serif,system-ui,sans-serif}
ul{list-style:none;margin:0;padding:0}li{margin:10px 0}li ul{padding-left:76px}li ul li{margin:2px 0;color:var(--muted);font:13.5px/1.5 ui-sans-serif,system-ui,sans-serif}
.head{display:flex;gap:12px;align-items:center}strong{font-weight:600;word-break:break-word}
.runs{flex:none;width:64px;height:20px;position:relative;background:linear-gradient(var(--line),var(--line)) center/100% 1px no-repeat}
.runs i{position:absolute;top:6px;width:8px;height:8px;border-radius:50%;background:var(--ok)}
.runs i.x{background:var(--hot);top:0}.runs i:nth-child(1){left:4px}.runs i:nth-child(2){left:28px}.runs i:nth-child(3){left:52px}
.runs i.x:nth-child(3){top:12px}`,
`<header><h1>${esc(report.input.name)}</h1><div class="score">${pct}%</div><p class="sub">${esc(headline)}</p></header>`,
(m) => `<i class="${m ? '' : 'x'}"></i>`);

// C: Pull request. Looks like it belongs next to a code review: diff gutters, runs as columns.
const C = page('Look C · Pull request', `
:root{--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--add:#dafbe1;--addb:#1a7f37;--del:#ffebe9;--delb:#cf222e;--warn:#fff8c5;--warnb:#9a6700;--box:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#3d444d;--add:#12261e;--addb:#3fb950;--del:#25171c;--delb:#f85149;--warn:#272115;--warnb:#d29922;--box:#151b23}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:900px;margin:0 auto;padding:24px 16px 64px}
header{border:1px solid var(--line);border-radius:8px;padding:14px 16px;background:var(--box);display:flex;gap:14px;align-items:center}
h1{font-size:16px;margin:0}.sub{margin:2px 0 0;color:var(--muted)}.score{margin-left:auto;font:600 13px ui-monospace,monospace;padding:4px 10px;border-radius:999px;background:var(--warn);color:var(--warnb);white-space:nowrap}
section{border:1px solid var(--line);border-radius:8px;margin-top:16px;overflow:hidden}
h2{font-size:14px;margin:0;padding:10px 14px;background:var(--box);border-bottom:1px solid var(--line)}.lede{margin:0;padding:8px 14px;color:var(--muted);border-bottom:1px solid var(--line)}
ul{list-style:none;margin:0;padding:0}section>ul>li{padding:8px 14px;border-bottom:1px solid var(--line)}section>ul>li:last-child{border-bottom:0}
.s-origin>ul>li{background:var(--del);box-shadow:inset 3px 0 var(--delb)}.s-inherited>ul>li{background:var(--warn);box-shadow:inset 3px 0 var(--warnb)}.s-same>ul>li{background:var(--add);box-shadow:inset 3px 0 var(--addb)}
li ul{padding-left:66px}li ul li{color:var(--muted);font-size:13px;margin:2px 0}
.head{display:flex;gap:10px;align-items:baseline}strong{font:600 13px ui-monospace,SFMono-Regular,monospace;word-break:break-word}
.runs{flex:none;display:inline-flex;gap:2px;font:600 11px ui-monospace,monospace}.runs b{width:18px;text-align:center;border-radius:4px;padding:0 2px;background:var(--box);border:1px solid var(--line)}
.runs b.x{color:var(--delb);border-color:var(--delb)}`,
`<header><div><h1>${esc(report.input.name)}</h1><p class="sub">${esc(headline)}</p></div><span class="score">${pct}% repeatable</span></header>`,
(m, i) => `<b class="${m ? '' : 'x'}">${i + 1}</b>`);

for (const [k, html] of [['a-lab-notebook', A], ['b-seismograph', B], ['c-pull-request', C]] as const) writeFileSync(join(here, `${k}.html`), html);
console.log('wrote 3 looks');
