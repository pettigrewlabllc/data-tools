import type { Report, StepResult } from '../types.js';
import { causeText, NO_CAUSE, SECTION, VERDICT, findingLine, headline, latentLede, rowsNote, whatMoved, where } from './words.js';

export interface Item { head: string; lines: string[] }
export interface Section { key: string; title: string; lede: string; items: Item[] }

/** The report as ordered sections. Terminal, Markdown and HTML all render exactly this. */
export function sections(r: Report): { headline: string; sections: Section[] } {
  const label = new Map([...r.steps, ...r.sources].map((s) => [s.step_id, s.label]));
  const head = (s: StepResult) => `${s.label} · ${where(s.location)}`;
  const out: Section[] = [];
  const add = (key: keyof typeof SECTION, items: Item[], lede?: string) => {
    if (items.length) out.push({ key, title: SECTION[key].title, lede: lede ?? SECTION[key].lede, items });
  };
  const scored = r.steps.filter((s) => !s.judgment);

  add('origin', scored.filter((s) => s.attribution === 'origin').map((s) => {
    const causes = s.findings.filter((f) => f.status === 'confirmed');
    return {
      head: head(s),
      lines: [whatMoved(s), rowsNote(s), ...(causes.length ? causes.map(findingLine) : [NO_CAUSE])].filter(Boolean),
    };
  }));
  add('inherited', scored.filter((s) => s.attribution === 'inherited').map((s) => ({
    head: head(s),
    lines: [`from ${s.from.map((x) => label.get(x) ?? x).join(', ') || 'an earlier step'}`, whatMoved(s),
      ...s.findings.filter((f) => f.status === 'upstream' && f.kind === 'definite').map((f) => `also check: ${findingLine(f)}`)],
  })));
  add('inconclusive', scored.filter((s) => s.attribution === 'inconclusive').map((s) => ({
    head: head(s),
    lines: [`inputs that changed: ${s.from.map((x) => label.get(x) ?? x).join(', ')}`, whatMoved(s)],
  })));
  if (!r.static_only) {
    add('latent', r.findings.filter((f) => f.status === 'latent').map((f) => ({ head: where(f), lines: [causeText(f)] })), latentLede(r.runs));
  } else {
    out.push({ key: 'static', title: 'Found in the code', lede: 'Each of these can make a run give a different answer.',
      items: r.findings.filter((f) => f.kind === 'definite').map((f) => ({ head: where(f), lines: [causeText(f)] })) });
    if (!out[out.length - 1].items.length) out.pop();
  }
  add('candidate', r.findings.filter((f) => f.status === 'candidate' || (r.static_only && f.kind === 'candidate')).map((f) => ({ head: where(f), lines: [causeText(f)] })));
  add('judgment', r.steps.filter((s) => s.judgment).map((s) => ({ head: head(s), lines: [s.verdict === 'same' ? `gave the same answer in all ${r.runs} runs` : `${VERDICT[s.verdict]} between runs`] })));
  if (!r.static_only) {
    const same = scored.filter((s) => s.verdict === 'same');
    if (same.length) out.push({ key: 'same', title: 'Same every run', lede: '', items: same.map((s) => ({ head: head(s), lines: [] })) });
  }
  const moved = r.sources.filter((s) => s.verdict !== 'same' && s.verdict !== 'skipped');
  const notes = [...moved.map((s) => `${s.label} was different between runs.`), ...r.notes];
  add('notes', notes.map((n) => ({ head: n, lines: [] })));
  return { headline: headline(r), sections: out };
}
