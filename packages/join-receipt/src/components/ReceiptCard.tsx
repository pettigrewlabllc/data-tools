import { useState } from 'react';
import {
  describePattern, buildPayload, buildRequest, redact, draftFixes, promptHash, SCORE_LABEL, AGG_FNS, CROSSWALK_KINDS,
  type PairResult, type Plan, type Receipt, type Draft, type TableProfile, type Transform, type KeyRef, type Aggregate, type AggFn, type Db,
} from '@data-tools/core';
import type { AiState } from './AiPanel';

export interface Card {
  id: string;
  pair: PairResult;
  choice: number;
  plan: Plan | null;
  receipt?: Receipt;
  unmatched?: { left: string[]; right: string[] };
  busy: boolean;
  error?: string;
  status: 'proposed' | 'approved' | 'rejected';
  proposedBy: 'rule' | 'user' | 'llm';
  llm: { model: string; prompt_sha256: string } | null;
  drafts: Draft[];
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (x: number) => (x > 0 && x < 0.001 ? '<0.1%' : `${(Math.round(x * 1000) / 10).toString()}%`);

export function transformLabel(t: Transform): string {
  switch (t.op) {
    case 'trim': return 'trim spaces';
    case 'lower': return 'lowercase';
    case 'upper': return 'uppercase';
    case 'lpad': return t.fill === '0' ? `zero-pad to ${t.width}` : `pad to ${t.width} with "${t.fill}"`;
    case 'crosswalk': return `${t.table === 'us_state' ? 'state' : 'country'} ${t.from} → ${t.to}`;
    case 'cast': return `read as ${t.to}`;
    case 'date_trunc': return `round to ${t.unit}`;
  }
}

interface Props {
  card: Card; profiles: TableProfile[]; ai: AiState;
  onPlan: (plan: Plan, patch?: Partial<Card>) => void;
  onStatus: (s: Card['status']) => void;
  onDrafts: (d: Draft[], llm: Card['llm']) => void;
  db: () => Promise<Db>;
}

export function ReceiptCard({ card, profiles, ai, onPlan, onStatus, onDrafts, db }: Props) {
  const { pair, plan, receipt: r } = card;
  const cand = pair.best[card.choice];
  const lp = profiles.find((p) => p.table === pair.left)!;
  const rp = profiles.find((p) => p.table === pair.right)!;
  const titleId = `c-${card.id}`;

  if (!plan || !cand) {
    return (
      <article className="card receipt" aria-labelledby={titleId}>
        <h3 id={titleId}>{lp.file} and {rp.file}</h3>
        <p className="warn">No shared column. Nothing in these two files lines up well enough to join on, so we're not proposing one.</p>
      </article>
    );
  }

  const keyName = (k: KeyRef) => `${profiles.find((p) => p.table === k.table)?.file ?? k.table}.${k.column}`;
  const setPlan = (p: Plan, patch?: Partial<Card>) => onPlan(p, patch);
  const statusClass = card.status === 'approved' ? 'is-approved' : card.status === 'rejected' ? 'is-rejected' : '';

  return (
    <article className={`card receipt ${statusClass}`} aria-labelledby={titleId} aria-busy={card.busy}>
      <header className="card-head">
        <div>
          <h3 id={titleId}>{lp.file} + {rp.file}</h3>
          <p className="on">on <code>{keyName(plan.join.left)}</code> = <code>{keyName(plan.join.right)}</code></p>
        </div>
        <div className="score" title={SCORE_LABEL}>
          <span className="score-n">{cand.score}</span>
          <span className="score-l">score<br />({SCORE_LABEL})</span>
        </div>
      </header>
      <p className="reason">{cand.reason}</p>
      {!pair.reliable && (
        <p className="warn">
          No reliable join between these two. This is the closest near-miss, and the others are under "Change it". Check it before you approve anything.
        </p>
      )}
      {card.error && <p className="warn" role="alert">That change didn't run: {card.error}</p>}

      {r ? <ReceiptBody r={r} plan={plan} lfile={lp.file} rfile={rp.file} rawRight={rp.rows} unmatched={card.unmatched} onRollUp={(a) => setPlan({ ...plan, aggregateRight: a })} /> : <p className="muted">Working out the receipt…</p>}

      <details className="edit">
        <summary>Change it</summary>
        {pair.best.length > 1 && (
          <fieldset>
            <legend>Key</legend>
            {pair.best.map((b, i) => (
              <label key={i} className="radio">
                <input type="radio" name={`key-${card.id}`} checked={card.choice === i}
                  onChange={() => setPlan({ join: { op: 'join_on', left: b.left, right: b.right, how: plan.join.how } }, { choice: i, proposedBy: 'rule' })} />
                <code>{b.left.column}</code> = <code>{b.right.column}</code> <span className="muted">score {b.score}</span>
              </label>
            ))}
          </fieldset>
        )}
        <label className="inline">Join type
          <select value={plan.join.how} onChange={(e) => setPlan({ ...plan, join: { ...plan.join, how: e.target.value as 'left' | 'inner' } })}>
            <option value="left">Keep every {lp.file} row (left join)</option>
            <option value="inner">Keep only rows that match (inner join)</option>
          </select>
        </label>
        <TransformEditor label={keyName(plan.join.left)} keyRef={plan.join.left} profiles={profiles} other={plan.join.right}
          onChange={(k) => setPlan({ ...plan, join: { ...plan.join, left: k } })} />
        <TransformEditor label={keyName(plan.join.right)} keyRef={plan.join.right} profiles={profiles} other={plan.join.left}
          onChange={(k) => setPlan({ ...plan, join: { ...plan.join, right: k } })} />
        {plan.aggregateRight && (
          <AggregateEditor agg={plan.aggregateRight} file={rp.file}
            onChange={(a) => setPlan({ ...plan, aggregateRight: a })} />
        )}
      </details>

      {ai.enabled && r && <Drafts card={card} plan={plan} receipt={r} profiles={profiles} ai={ai} db={db} onDrafts={onDrafts} onUse={(d, llm) => setPlan({ ...plan, join: { ...plan.join, left: { ...plan.join.left, transforms: d.left }, right: { ...plan.join.right, transforms: d.right } } }, { proposedBy: 'llm', llm })} />}

      <div className="decide">
        {card.status === 'proposed' ? (
          <>
            <button className="primary" disabled={card.busy || !r} onClick={() => onStatus('approved')}>Approve</button>
            <button onClick={() => onStatus('rejected')}>Reject</button>
          </>
        ) : (
          <>
            <span className="verdict" role="status">{card.status === 'approved' ? 'Approved. It goes in your downloads.' : 'Rejected. It stays out of your downloads.'}</span>
            <button className="quiet" onClick={() => onStatus('proposed')}>Undo</button>
          </>
        )}
        <span className="muted by">Proposed by {card.proposedBy === 'llm' ? `a model (${card.llm?.model})` : card.proposedBy === 'user' ? 'you' : 'the rules'}</span>
      </div>
    </article>
  );
}

function ReceiptBody({ r, plan, lfile, rfile, rawRight, unmatched, onRollUp }: {
  r: Receipt; plan: Plan; lfile: string; rfile: string; rawRight: number; unmatched?: { left: string[]; right: string[] }; onRollUp: (a: Aggregate) => void;
}) {
  const how = plan.join.how === 'left' ? 'left join' : 'inner join';
  return (
    <div className="paper">
      <dl>
        <div><dt>Matched</dt><dd>{fmt(r.matchedLeft)} of {fmt(r.leftRows)} {lfile} rows ({pct(r.matchRateAfter)})</dd></div>
        <div>
          <dt>Didn't match</dt>
          <dd>
            {fmt(r.unmatchedLeft)} {lfile} rows
            {r.patternsLeft.map((p, i) => <p key={i} className="pattern">{describePattern(p)}</p>)}
            {r.unmatchedLeft > 0 && unmatched?.left.length ? <p className="muted small">For example: {unmatched.left.slice(0, 4).map((v, i) => <span key={v}>{i ? ", " : ""}<code>{v}</code></span>)}</p> : null}
          </dd>
        </div>
        <div>
          <dt>Left over</dt>
          <dd>
            {fmt(r.unmatchedRight)} of {fmt(r.rightRows)} {rfile} rows found nothing to join to
            {r.patternsRight.map((p, i) => <p key={i} className="pattern">{describePattern(p)}</p>)}
          </dd>
        </div>
        {plan.aggregateRight && (
          <div><dt>Rolled up</dt><dd>{rfile} from {fmt(rawRight)} rows to {fmt(r.rightRows)}, one per {plan.aggregateRight.by.join(', ')}</dd></div>
        )}
        <div><dt>Rows after</dt><dd>{fmt(r.joinedRows)} ({how})</dd></div>
        {r.normalisations && (
          <div><dt>Cleanup</dt><dd>{r.normalisations[0].toUpperCase() + r.normalisations.slice(1)} took the match rate from {pct(r.matchRateBefore ?? 0)} to {pct(r.matchRateAfter)}.</dd></div>
        )}
      </dl>
      {r.fanoutWarning && (
        <div className="fanout" role="note">
          <p>
            <strong>This join multiplies rows.</strong> {rfile} has up to {fmt(r.maxPerKeyRight)} rows per key, so each matched {lfile} row turns into {r.fanout.toFixed(2).replace(/\.00$/, '')} on average. Sums and averages over the result will be off.
          </p>
          {r.proposedAggregate && <button onClick={() => onRollUp(r.proposedAggregate!)}>Roll {rfile} up to one row per {r.proposedAggregate.by.join(', ')} first</button>}
        </div>
      )}
      {r.samples.length > 0 && (
        <table className="samples">
          <caption>Before and after the cleanup</caption>
          <thead><tr><th scope="col">File</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
          <tbody>
            {r.samples.map((s, i) => <tr key={i}><td>{s.side === 'left' ? lfile : rfile}</td><td><code>{s.raw}</code></td><td><code>{s.transformed ?? '(no match in lookup)'}</code></td></tr>)}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TransformEditor({ label, keyRef, other, profiles, onChange }: { label: string; keyRef: KeyRef; other: KeyRef; profiles: TableProfile[]; onChange: (k: KeyRef) => void }) {
  const otherCol = profiles.find((p) => p.table === other.table)?.columns.find((c) => c.name === other.column);
  const width = Math.max(1, Math.min(20, otherCol?.maxLen ?? 5));
  const options: { label: string; t: Transform }[] = [
    { label: 'trim spaces', t: { op: 'trim' } },
    { label: 'lowercase', t: { op: 'lower' } },
    { label: 'uppercase', t: { op: 'upper' } },
    { label: `zero-pad to ${width}`, t: { op: 'lpad', width, fill: '0' } },
    { label: 'read as a number', t: { op: 'cast', to: 'integer' } },
    { label: 'read as a date', t: { op: 'cast', to: 'date' } },
    { label: 'round dates to the day', t: { op: 'date_trunc', unit: 'day' } },
    { label: 'round dates to the month', t: { op: 'date_trunc', unit: 'month' } },
    { label: 'round dates to the year', t: { op: 'date_trunc', unit: 'year' } },
    ...(['us_state', 'country'] as const).flatMap((table) =>
      CROSSWALK_KINDS[table].flatMap((from) => CROSSWALK_KINDS[table].filter((to) => to !== from).map((to) => ({
        label: `${table === 'us_state' ? 'state' : 'country'} ${from} → ${to}`, t: { op: 'crosswalk', table, from, to } as Transform,
      })))),
  ];
  return (
    <div className="tx">
      <span className="tx-label"><code>{label}</code></span>
      <ul className="chips" aria-label={`Cleanup for ${label}`}>
        {keyRef.transforms.length === 0 && <li className="muted">no cleanup</li>}
        {keyRef.transforms.map((t, i) => (
          <li key={i} className="chip">
            {transformLabel(t)}
            <button className="x" aria-label={`Remove ${transformLabel(t)}`} onClick={() => onChange({ ...keyRef, transforms: keyRef.transforms.filter((_, j) => j !== i) })}>×</button>
          </li>
        ))}
      </ul>
      <select aria-label={`Add a cleanup step to ${label}`} value="" disabled={keyRef.transforms.length >= 6}
        onChange={(e) => { const o = options[Number(e.target.value)]; if (o) onChange({ ...keyRef, transforms: [...keyRef.transforms, o.t] }); }}>
        <option value="">Add a step…</option>
        {options.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
      </select>
    </div>
  );
}

function AggregateEditor({ agg, file, onChange }: { agg: Aggregate; file: string; onChange: (a: Aggregate | null) => void }) {
  return (
    <fieldset className="agg">
      <legend>Roll {file} up to one row per {agg.by.join(', ')}</legend>
      <table>
        <tbody>
          {agg.measures.map((m, i) => (
            <tr key={m.column}>
              <th scope="row"><code>{m.column}</code></th>
              <td>
                <select aria-label={`How to combine ${m.column}`} value={m.fn} onChange={(e) => onChange({ ...agg, measures: agg.measures.map((x, j) => (j === i ? { ...x, fn: e.target.value as AggFn } : x)) })}>
                  {AGG_FNS.map((f) => <option key={f} value={f}>{f === 'first' ? 'first (smallest)' : f}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="quiet" onClick={() => onChange(null)}>Don't roll it up</button>
    </fieldset>
  );
}

function Drafts({ card, plan, receipt, profiles, ai, db, onDrafts, onUse }: {
  card: Card; plan: Plan; receipt: Receipt; profiles: TableProfile[]; ai: AiState; db: () => Promise<Db>;
  onDrafts: (d: Draft[], llm: Card['llm']) => void; onUse: (d: Extract<Draft, { ok: true }>, llm: Card['llm']) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cand = { ...card.pair.best[card.choice], left: plan.join.left, right: plan.join.right };
  const payload = buildPayload(profiles, cand, receipt, card.unmatched ?? { left: [], right: [] }, ai.mode);
  const req = buildRequest(ai, payload);
  const send = async () => {
    setBusy(true); setError('');
    try {
      const d = await draftFixes(await db(), profiles, cand, plan, receipt, payload, ai);
      onDrafts(d, { model: ai.model, prompt_sha256: await promptHash() });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  return (
    <div className="drafts">
      {!open && <button onClick={() => setOpen(true)}>Draft a fix with {ai.model}</button>}
      {open && (
        <div className="payload">
          <p><strong>This is exactly what will be sent</strong> to <code>{req.url}</code>. {ai.mode === 'masked' ? 'Sample values are masked.' : 'Sample values are NOT masked.'}</p>
          <pre tabIndex={0}>{JSON.stringify({ headers: redact(req.headers), body: req.body }, null, 2)}</pre>
          <button className="primary" disabled={busy || (ai.kind === 'anthropic' && !ai.apiKey)} onClick={() => void send()}>{busy ? 'Waiting for the model…' : 'Send it'}</button>
          <button className="quiet" onClick={() => setOpen(false)}>Cancel</button>
          {ai.kind === 'anthropic' && !ai.apiKey && <p className="muted">Add your API key above first.</p>}
        </div>
      )}
      {error && <p className="warn" role="alert">{error}</p>}
      {card.drafts.length > 0 && (
        <ul className="draft-list">
          {card.drafts.map((d, i) => d.ok ? (
            <li key={i}>
              <p><strong>Drafted by {card.llm?.model}:</strong> {d.why || 'no reason given'}</p>
              <p className="muted">{[...d.left.map((t) => `left: ${transformLabel(t)}`), ...d.right.map((t) => `right: ${transformLabel(t)}`)].join(' · ') || 'no cleanup'} · match rate {pct(d.receipt.matchRateAfter)} ({d.delta >= 0 ? '+' : ''}{(d.delta * 100).toFixed(1)} points)</p>
              <button onClick={() => onUse(d, card.llm)}>Use this</button>
            </li>
          ) : (
            <li key={i} className="rejected"><p><strong>Rejected:</strong> {d.error}</p></li>
          ))}
        </ul>
      )}
    </div>
  );
}
