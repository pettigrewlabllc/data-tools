import { useState } from 'react';
import {
  CLASS_ORDER, M, OPTION_LABEL, evaluateRules, labelOf, optionsFor, crosswalk,
  type Choices, type Finding, type OptionId,
} from '@data-tools/core';
import { C } from '../copy';
import { colKey } from '../analysis';

interface Props {
  before: Finding[]; after: Finding[];
  choices: Choices; setChoice: (key: string, id: OptionId | null) => void;
  ready: boolean; hasData: boolean;
}

function Detail({ f, after, choice, setChoice }: { f: Finding; after: Finding | undefined; choice: OptionId | undefined; setChoice: (id: OptionId | null) => void }) {
  const hits = evaluateRules([f.category]);
  const opts = optionsFor(f.category, { notDisclosed: f.cls !== 'disclosed' });
  const chosen = opts.find((o) => o.id === choice);
  return (
    <div className="detail" data-testid="finding-detail">
      <p>{f.text}</p>
      <h4>{C.crosswalkHeading}</h4>
      <ul className="cites">{crosswalk(f.category).map((x, i) => <li key={i}><strong>{x.framework}</strong> {x.cite}. {x.note}</li>)}</ul>
      <h4>{C.rulesHeading}</h4>
      {hits.length === 0 ? <p className="muted">{C.noRules}</p> : hits.map((h) => (
        <div key={h.rule.id} className="rule"><strong>{h.rule.title}</strong><p>{h.rule.summary}</p><p className="muted">{h.rule.sources.join('; ')}</p></div>
      ))}
      <h4>{C.optionsHeading}</h4>
      <ul className="options">
        {opts.map((o) => (
          <li key={o.id}>
            <button className={o.id === choice ? 'is-on' : ''} aria-pressed={o.id === choice} onClick={() => setChoice(o.id === choice ? null : o.id)}>{OPTION_LABEL[o.id]}</button>
            <span className="muted"> {o.detail}.{o.note === 'pseudonymises' ? ' ' + M.hashNote : ''}{o.note === 'restricted' ? ' ' + M.restrictedNote : ''}</span>
          </li>
        ))}
      </ul>
      {chosen && (
        <p className="after" role="status">
          <strong>{C.afterLabel}:</strong>{' '}
          {chosen.after === null ? M.removedFromData(labelOf(f.category)) : after
            ? `${C.classLabel(after.cls)}.${chosen.after !== f.category ? ' ' + M.becomes(labelOf(f.category), labelOf(chosen.after)) : ''}`
            : C.goneFromData}
          {' '}<button className="quiet" onClick={() => setChoice(null)}>{C.clearChoice}</button>
        </p>
      )}
    </div>
  );
}

export function FindingsStep(p: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const counted = p.before.filter((f) => !f.provisional);
  const provisional = p.before.filter((f) => f.provisional);
  const tables = [...new Set(counted.map((f) => f.table))];
  const afterFor = (f: Finding) => p.after.find((x) => x.table === f.table && x.column === f.column);

  return (
    <section aria-labelledby="s3-h" className="step">
      <h2 id="s3-h">{C.step3}</h2>
      <p className="hint">{C.step3Help}</p>
      {!p.ready && <p className="hint">{C.findingsLocked}</p>}
      {p.ready && !p.hasData && <p className="hint">{C.findingsNoData}</p>}
      {p.ready && p.hasData && (
        <>
          <ul className="counts" aria-label={C.step3}>
            {CLASS_ORDER.map((c) => <li key={c} className={`count c-${c}`}><span className="n">{counted.filter((f) => f.cls === c).length}</span> {C.classLabel(c)}</li>)}
          </ul>
          {counted.length === 0 && <p>{C.noFindings}</p>}
          {tables.map((t) => (
            <div key={t} className="by-table">
              <h3>{C.tablesHeading}: <code>{t}</code></h3>
              {CLASS_ORDER.map((cls) => {
                const list = counted.filter((f) => f.table === t && f.cls === cls);
                if (!list.length) return null;
                return (
                  <div key={cls} className={`class c-${cls}`}>
                    <h4>{C.classLabel(cls)} <span className="muted">({list.length})</span></h4>
                    <ul className="findings">
                      {list.map((f) => {
                        const k = colKey(f.table, f.column);
                        const isOpen = open === k;
                        return (
                          <li key={k} className={isOpen ? 'finding is-open' : 'finding'}>
                            <button className="head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : k)}>
                              <code>{f.column}</code> <span className="cat">{labelOf(f.category)}</span>
                              {p.choices[k] && <span className="chip is-ok">{OPTION_LABEL[p.choices[k]]}</span>}
                            </button>
                            <p className="text">{f.text}</p>
                            {isOpen && <Detail f={f} after={afterFor(f)} choice={p.choices[k]} setChoice={(id) => p.setChoice(k, id)} />}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          ))}
          {provisional.length > 0 && (
            <div className="by-table provisional">
              <h3>{C.provisionalHeading}</h3>
              <p className="hint">{C.provisionalHelp}</p>
              <ul className="findings">{provisional.map((f) => <li key={colKey(f.table, f.column)} className="finding"><code>{f.table}.{f.column}</code> <span className="cat">{labelOf(f.category)}</span></li>)}</ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export { CLASS_ORDER };
