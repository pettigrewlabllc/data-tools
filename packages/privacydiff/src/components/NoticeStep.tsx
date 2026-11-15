import { useState } from 'react';
import { CATEGORIES, labelOf, PURPOSE_LABEL, tickGroups, type Policy, type PolicyLine, type Status } from '@data-tools/core';
import { C } from '../copy';
import { AiPanel, type AiState } from './AiPanel';

interface Props {
  notice: string; setNotice: (s: string) => void;
  policy: Policy | null; setPolicy: (p: Policy) => void;
  confirmed: boolean; onConfirm: () => void;
  onDraft: () => void; onImport: (f: File) => void; onOpenPolicy: (f: File) => void; onTick: (ids: string[]) => void;
  unrecognised: string[]; error: string; onDownload: () => void;
  ai: AiState; setAi: (a: AiState) => void; aiBusy: boolean; aiMessage: string; onAi: () => void;
}

function Quote({ line, sentences, active }: { line: PolicyLine; sentences: Policy['sentences']; active: boolean }) {
  if (!line.quote) return <span className="muted">{C.noSentence}</span>;
  const s = sentences.find((x) => x.id === line.sentence);
  return <span className={active ? 'quote is-active' : 'quote'}>{s ? <small className="muted">{C.paragraphLabel(s.paragraph)}. </small> : null}{line.quote}</span>;
}

export function NoticeStep(p: Props) {
  const [active, setActive] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const policy = p.policy;
  const edit = (categories: PolicyLine[]) => policy && p.setPolicy({ ...policy, categories });
  const have = new Set(policy?.categories.map((l) => l.category));
  const activeSentence = policy?.categories.find((l) => l.category === active)?.sentence;

  return (
    <section aria-labelledby="s1-h" className="step">
      <h2 id="s1-h">{C.step1}</h2>
      <p className="hint">{C.step1Help}</p>
      <label className="block">{C.noticeLabel}
        <textarea value={p.notice} onChange={(e) => p.setNotice(e.target.value)} placeholder={C.noticePlaceholder} rows={9} spellCheck={false} />
      </label>
      <div className="row">
        <button className="primary" onClick={p.onDraft} disabled={!p.notice.trim()}>{C.draftButton}</button>
        <label className="button">{C.importButton}
          <input type="file" accept=".yml,.yaml,.json,.jsonld" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImport(f); e.target.value = ''; }} />
        </label>
        <label className="button">{C.openPolicyButton}
          <input type="file" accept=".yml,.yaml" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onOpenPolicy(f); e.target.value = ''; }} />
        </label>
      </div>
      <p className="hint small">{C.importHelp}</p>
      {p.error && <p className="errors" role="alert">{p.error}</p>}

      <details className="tick">
        <summary>{C.tickSummary}</summary>
        <p className="hint">{C.tickHelp}</p>
        {tickGroups().map((g) => (
          <fieldset key={g.group}>
            <legend>{g.group}</legend>
            {g.categories.map((id) => (
              <label key={id} className="check">
                <input type="checkbox" checked={ticked.has(id)} onChange={(e) => setTicked((t) => { const n = new Set(t); if (e.target.checked) n.add(id); else n.delete(id); return n; })} />
                {labelOf(id)}
              </label>
            ))}
          </fieldset>
        ))}
        <button onClick={() => p.onTick([...ticked])} disabled={!ticked.size}>{C.tickApply}</button>
      </details>

      {policy && (
        <div className="draft" aria-labelledby="draft-h">
          <h3 id="draft-h">{C.draftHeading}</h3>
          {p.unrecognised.length > 0 && <p className="warn" role="note">{C.unrecognised(p.unrecognised)}</p>}
          <p className="hint">{C.draftHelp}</p>
          {policy.categories.length === 0 ? <p>{C.draftEmpty}</p> : (
            <div className="table-wrap" role="region" aria-label={C.draftHeading} tabIndex={0}>
              <table className="lines">
                <thead><tr><th scope="col">{C.colCategory}</th><th scope="col">{C.colStatus}</th><th scope="col">{C.colSentence}</th><th scope="col">{C.colAction}</th></tr></thead>
                <tbody>
                  {policy.categories.map((l) => (
                    <tr key={l.category} className={l.category === active ? 'is-active' : ''} onMouseEnter={() => setActive(l.category)} onFocus={() => setActive(l.category)}>
                      <th scope="row">{labelOf(l.category)}<br /><code>{l.category}</code></th>
                      <td>
                        <select aria-label={`${C.colStatus}: ${labelOf(l.category)}`} value={l.status} onChange={(e) => edit(policy.categories.map((x) => (x === l ? { ...x, status: e.target.value as Status } : x)))}>
                          {(['disclosed', 'vague', 'not_collected'] as Status[]).map((s) => <option key={s} value={s}>{C.statusLabel(s)}</option>)}
                        </select>
                      </td>
                      <td><Quote line={l} sentences={policy.sentences} active={l.category === active} /></td>
                      <td><button className="quiet" onClick={() => edit(policy.categories.filter((x) => x !== l))}>{C.remove}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="row">
            <label>{C.addLineLabel}
              <select value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">{C.addLine}</option>
                {CATEGORIES.filter((c) => !have.has(c.id)).map((c) => <option key={c.id} value={c.id}>{labelOf(c.id)}</option>)}
              </select>
            </label>
            <button disabled={!adding} onClick={() => { edit([...policy.categories, { category: adding, status: 'disclosed', source: 'ticked' }]); setAdding(''); }}>{C.addLine}</button>
          </div>
          <dl className="facts">
            <div><dt>{C.purposesHeading}</dt><dd>{policy.purposes.length ? policy.purposes.map((u) => PURPOSE_LABEL[u.purpose] ?? u.purpose).join(', ') : C.none}</dd></div>
            <div><dt>{C.sensitiveHeading}</dt><dd>{policy.sensitive.length ? policy.sensitive.map(labelOf).join(', ') : C.none}</dd></div>
          </dl>
          {policy.sentences.length > 0 && (
            <details className="sentences" open>
              <summary>{C.sentencesHeading}</summary>
              {policy.sentences.map((s) => (
                <p key={s.id} id={`sentence-${s.id}`} className={s.id === activeSentence ? 'is-active' : ''}>
                  <small className="muted">{s.id} · {C.paragraphLabel(s.paragraph)}</small><br />
                  {s.id === activeSentence ? <mark>{s.text}</mark> : s.text}
                </p>
              ))}
            </details>
          )}
          <div className="row">
            <button className="primary" onClick={p.onConfirm} disabled={p.confirmed}>{C.confirmPolicy}</button>
            <button onClick={p.onDownload} disabled={!p.confirmed}>{C.downloadPolicy}</button>
          </div>
          <p className={p.confirmed ? 'ok' : 'hint'} role="status">{p.confirmed ? C.confirmedPolicy : C.needConfirm}</p>
        </div>
      )}

      <AiPanel ai={p.ai} setAi={p.setAi} notice={p.notice} busy={p.aiBusy} message={p.aiMessage} onRun={p.onAi} />
    </section>
  );
}
