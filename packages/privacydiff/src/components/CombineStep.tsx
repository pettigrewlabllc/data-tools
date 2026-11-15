import { labelOf, M, type CombinationResult, type RiskySubset, type UniquenessResult } from '@data-tools/core';
import { C } from '../copy';
import type { Link, TableState } from '../analysis';

export interface Combo {
  selected: string[];
  links: Record<string, Link>;
  suggested: Record<string, boolean>;
  qiOff: Record<string, boolean>;
}
export interface UniqueOut {
  busy: boolean; error: string; entityLabel: string;
  qi: { key: string; label: string }[]; direct: string[];
  result?: UniquenessResult; subsets?: RiskySubset[];
}

interface Props {
  tables: TableState[]; combo: Combo; setCombo: (c: Combo) => void;
  combination: CombinationResult | null; unique: UniqueOut;
  hasData: boolean; ready: boolean;
}

export function CombineStep({ tables, combo, setCombo, combination, unique, hasData, ready }: Props) {
  const sel = combo.selected.map((n) => tables.find((t) => t.name === n)!).filter(Boolean);
  const base = sel[0];
  const toggle = (name: string, on: boolean) => {
    const selected = on ? [...combo.selected, name] : combo.selected.filter((n) => n !== name);
    setCombo({ ...combo, selected });
  };
  return (
    <section aria-labelledby="s4-h" className="step">
      <h2 id="s4-h">{C.step4}</h2>
      <p className="hint">{C.step4Help}</p>
      {!ready && <p className="hint">{C.findingsLocked}</p>}
      {ready && (
        <>
          <fieldset>
            <legend>{C.pickTables}</legend>
            {tables.map((t) => (
              <label key={t.name} className="check">
                <input type="checkbox" checked={combo.selected.includes(t.name)} onChange={(e) => toggle(t.name, e.target.checked)} />
                {t.file}
              </label>
            ))}
          </fieldset>

          {sel.length >= 2 && base.source === 'file' && (
            <div className="links">
              <h3>{C.keyHeading}</h3>
              {sel.slice(1).map((t) => {
                const l = combo.links[t.name];
                if (t.source !== 'file') return null;
                return (
                  <div key={t.name} className="pick">
                    <span>{C.keyFor(t.file, base.file)}</span>
                    <label>{C.keyBase}
                      <select aria-label={`${t.file}: ${C.keyBase} ${base.file}`} value={l?.base ?? ''} onChange={(e) => setCombo({ ...combo, links: { ...combo.links, [t.name]: { base: e.target.value, other: l?.other ?? '' } }, suggested: { ...combo.suggested, [t.name]: false } })}>
                        <option value="">-</option>
                        {base.columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                    </label>
                    <label>{C.keyOther}
                      <select aria-label={`${t.file}: ${C.keyOther}`} value={l?.other ?? ''} onChange={(e) => setCombo({ ...combo, links: { ...combo.links, [t.name]: { base: l?.base ?? '', other: e.target.value } }, suggested: { ...combo.suggested, [t.name]: false } })}>
                        <option value="">-</option>
                        {t.columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                    </label>
                    {combo.suggested[t.name] ? <span className="chip is-ok">{C.keySuggested}</span> : !l?.base && <span className="muted">{C.keyNone}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {sel.length < 2 ? <p className="hint">{C.combineNeedsTwo}</p> : combination && (
            <div className="combination" data-testid="combination">
              <h3>{C.combineHeading}</h3>
              <p>{M.combinationBrings(combination.union.length, sel.length)}</p>
              <ul className="inline-list">{combination.perTable.map((t) => <li key={t.table}><code>{t.table}</code>: {t.categories.length ? t.categories.map(labelOf).join(', ') : C.none}</li>)}</ul>
              <h4>{C.combinationOnlyHeading}</h4>
              {combination.combinationOnly.length === 0 ? <p className="muted">{M.noRuleFires}</p> : combination.combinationOnly.map((h) => (
                <div key={h.rule.id} className="rule is-new"><strong>{h.rule.title}</strong> <span className="chip is-warn">{M.combinationOnly}</span><p>{h.rule.summary}</p><p className="muted">{h.rule.sources.join('; ')}. {M.because(h.matched)}</p></div>
              ))}
              {combination.hits.length > combination.combinationOnly.length && (
                <>
                  <h4>{C.alreadyHeading}</h4>
                  <ul>{combination.hits.filter((h) => !combination.combinationOnly.includes(h)).map((h) => (
                    <li key={h.rule.id}><strong>{h.rule.title}</strong>. {combination.perTable.filter((t) => t.hits.some((x) => x.rule.id === h.rule.id)).map((t) => M.firesInTable(t.table)).join(' ')}</li>
                  ))}</ul>
                </>
              )}
            </div>
          )}

          {sel.length >= 1 && (
            <div className="unique" data-testid="uniqueness">
              <h3>{C.uniqueHeading}</h3>
              {!hasData || !sel.some((t) => t.source === 'file') ? <p className="hint">{C.uniqueNeedsData}</p> : (
                <>
                  <p className="hint small">{C.uniqueEntity}: {unique.entityLabel}. {C.uniqueNote}</p>
                  <fieldset>
                    <legend>{C.qiHeading}</legend>
                    {unique.qi.length === 0 && <p className="muted">{C.qiNone}</p>}
                    {unique.qi.map((q) => (
                      <label key={q.key} className="check">
                        <input type="checkbox" checked={!combo.qiOff[q.key]} onChange={(e) => setCombo({ ...combo, qiOff: { ...combo.qiOff, [q.key]: !e.target.checked } })} />
                        {q.label}
                      </label>
                    ))}
                    {unique.direct.length > 0 && <p className="muted small">{C.directSkipped} ({unique.direct.join(', ')})</p>}
                  </fieldset>
                  {unique.busy && <p role="status">{C.working}</p>}
                  {unique.error && <p className="errors" role="alert">{unique.error}</p>}
                  {unique.result && !unique.busy && (
                    <div aria-live="polite">
                      <p className="big" data-testid="unique-summary">{M.uniqueSummary(unique.result.unique, unique.result.total, unique.result.share, unique.entityLabel === C.uniqueEntityRows ? M.uniqueRows : M.uniqueEntities)}</p>
                      <h4>{C.subsetsHeading}</h4>
                      {unique.subsets && unique.subsets.length === 0 ? <p className="muted">{C.subsetsNone}</p> : (
                        <table className="subsets"><thead><tr><th scope="col">{C.subsetsCols}</th><th scope="col">{C.subsetsShare}</th></tr></thead>
                          <tbody>{unique.subsets?.map((s) => <tr key={s.columns.join()}><td>{s.columns.join(' + ')}</td><td className="num">{Math.round(s.share * 1000) / 10}%</td></tr>)}</tbody></table>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
