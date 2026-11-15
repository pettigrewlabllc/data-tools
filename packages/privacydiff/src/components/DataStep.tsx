import { useState } from 'react';
import { CATEGORIES, CONFIRM_BELOW, labelOf, type LoadError } from '@data-tools/core';
import { C } from '../copy';
import { SAMPLE_DDL_HINT } from '../samples';
import { colKey, finalCategory, kindOf, type Confirmed, type Overrides, type TableState } from '../analysis';

interface Props {
  tables: TableState[]; overrides: Overrides; confirmed: Confirmed;
  setOverride: (key: string, category: string | null) => void; confirm: (keys: string[]) => void;
  onFiles: (files: FileList | null) => void; onDdl: (text: string) => void;
  status: string; errors: LoadError[]; busy: boolean; ddlMessage: string;
}

const KIND = { direct: C.kindDirect, quasi: C.kindQuasi, other: C.kindOther } as const;

export function DataStep(p: Props) {
  const [ddl, setDdl] = useState('');
  const [dragging, setDragging] = useState(false);
  const pending = p.tables.flatMap((t) => t.columns.filter((c) => {
    const k = colKey(t.name, c.name);
    return c.proposal.category && !(k in p.overrides) && !p.confirmed[k];
  }).map((c) => colKey(t.name, c.name)));
  return (
    <section aria-labelledby="s2-h" className="step">
      <h2 id="s2-h">{C.step2}</h2>
      <p className="hint">{C.step2Help}</p>
      <div className={`drop ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); p.onFiles(e.dataTransfer.files); }} aria-label={C.addFiles}>
        <div className="row">
          <label className={`button ${p.busy ? 'is-disabled' : ''}`}>{C.addFiles}
            <input type="file" multiple accept=".csv,.tsv,.txt,.parquet,.json,.ndjson,.jsonl,.xlsx" disabled={p.busy} onChange={(e) => { p.onFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <span className="hint">{C.dropHint}</span>
        </div>
        {p.status && <p className="status" role="status">{p.status}</p>}
        {p.errors.length > 0 && <ul className="errors" role="alert">{p.errors.map((e, i) => <li key={i}>{C.loadError(e.file, e.error)}</li>)}</ul>}
      </div>
      <label className="block">{C.ddlLabel}
        <textarea value={ddl} onChange={(e) => setDdl(e.target.value)} placeholder={SAMPLE_DDL_HINT} rows={5} spellCheck={false} />
      </label>
      <div className="row">
        <button onClick={() => { p.onDdl(ddl); }} disabled={!ddl.trim()}>{C.ddlButton}</button>
        {p.ddlMessage && <span className="errors" role="status">{p.ddlMessage}</span>}
      </div>

      {pending.length > 0 && <div className="row"><button onClick={() => p.confirm(pending)}>{C.confirmAll(pending.length)}</button></div>}

      <div className="tables">
        {p.tables.map((t) => (
          <article key={t.name} className="file" aria-labelledby={`t-${t.name}`}>
            <h3 id={`t-${t.name}`}>{t.file}</h3>
            <p className="meta">{C.tableMeta(t.rows, t.columns.length, t.source)}</p>
            <div className="table-wrap" tabIndex={0} role="region" aria-label={`${t.file}: ${C.columnsOpen(t.columns.length)}`}>
              <table className="cols">
                <thead><tr><th scope="col">{C.colName}</th><th scope="col">{C.colType}</th><th scope="col">{C.colProposed}</th></tr></thead>
                <tbody>
                  {t.columns.map((c) => {
                    const k = colKey(t.name, c.name);
                    const cat = finalCategory(t, c, p.overrides);
                    const changed = k in p.overrides;
                    const isConfirmed = changed || !!p.confirmed[k];
                    const low = !!cat && !changed && c.proposal.confidence < CONFIRM_BELOW;
                    return (
                      <tr key={c.name}>
                        <th scope="row"><code className="colname">{c.name}</code></th>
                        <td className="type">{c.type || '-'}</td>
                        <td>
                          <select aria-label={`${C.colProposed}: ${t.name}.${c.name}`} value={cat ?? ''} onChange={(e) => p.setOverride(k, e.target.value || null)}>
                            <option value="">{C.notPersonal}</option>
                            {CATEGORIES.filter((x) => x.id !== 'user').map((x) => <option key={x.id} value={x.id}>{labelOf(x.id)}</option>)}
                          </select>
                          {cat && (
                            <span className="chips-inline">
                              <span className={`chip ${isConfirmed ? 'is-ok' : low ? 'is-warn' : ''}`}>{isConfirmed ? C.confirmedChip : low ? C.needsConfirming : C.confident}</span>
                              <span className="chip">{KIND[kindOf(cat)]}</span>
                              {!isConfirmed && <button className="quiet" onClick={() => p.confirm([k])}>{C.confirmButton}</button>}
                            </span>
                          )}
                          {!changed && c.proposal.reasons.length > 0 && <small className="why muted">{c.proposal.reasons.slice(0, 2).join(' ')}</small>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
