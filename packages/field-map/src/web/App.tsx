import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Payload } from '../engine/ai/payload';
import type { DraftResult } from '../engine/ai/drafts';
import { PROMPT } from '../engine/ai/drafts';
import { canonical } from '../engine/canonical';
import { JSONATA_VERSION, sha256, TOOL_VERSION, writeFieldMap, type FieldDecision } from '../engine/fieldmap-yml';
import { parsePath, type FieldMapping, type Path, type Transform } from '../engine/grammar';
import type { Json } from '../engine/json';
import { G, T, type Candidate, type FieldRec } from '../engine/recommend';
import type { Loosen, Target, TargetKind } from '../engine/target';
import type { Validation } from '../engine/validate';
import { buildRequest, callModel, DEFAULTS, redact, type ModelConfig } from '../shared/providers';
import { call } from './protocol';
import { SAMPLES } from './samples';

type Decision = { candidate: Candidate | null; by: 'rule' | 'user' | 'llm'; answer?: string; approved: boolean; rejected: boolean };

interface Loaded { files: { name: string; records: number; recordRoot: string[] | null }[]; errors: { name: string; reason: string }[]; records: number; bigIntPaths: string[]; thin: boolean }

const KIND_LABEL: Record<TargetKind, string> = { schema: 'JSON Schema', example: 'An example record', columns: 'Column names' };
const KIND_HINT: Record<TargetKind, string> = {
  schema: 'Draft 2020-12 or 07. Only local $ref is read; nothing is fetched.',
  example: "One record in the shape you want. You'll see the schema it implies before anything is scored.",
  columns: 'One per line. Dots nest (customer.email), and items[].sku means a field inside a list of items.',
};

const download = (name: string, text: string, type = 'text/plain') => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

function transformLabel(t: Transform): string {
  switch (t.op) {
    case 'cast': return `cast ${t.to}`;
    case 'parse_date': return `${t.from.replace('_', ' ')} → ${t.out}`;
    case 'scale': return t.power < 0 ? `÷ ${10 ** -t.power}` : `× ${10 ** t.power}`;
    case 'value_map': return `map ${Object.keys(t.map).length} values`;
    default: return t.op;
  }
}

function toCsv(rows: Json[]): string {
  const flat = rows.map((r) => {
    const o: Record<string, string> = {};
    const walk = (v: Json, pre: string) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) walk(x, pre ? `${pre}.${k}` : k);
      else o[pre] = v === null || v === undefined ? '' : Array.isArray(v) ? JSON.stringify(v) : String(v);
    };
    walk(r, '');
    return o;
  });
  const cols = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [cols.join(','), ...flat.map((r) => cols.map((c) => esc(r[c] ?? '')).join(','))].join('\n') + '\n';
}

export function App() {
  const [pasted, setPasted] = useState('');
  const [files, setFiles] = useState<{ name: string; text: string }[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [kind, setKind] = useState<TargetKind>('schema');
  const [targetText, setTargetText] = useState('');
  const [loosen, setLoosen] = useState<Loosen>({});
  const [inferred, setInferred] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [recs, setRecs] = useState<FieldRec[]>([]);
  const [meta, setMeta] = useState<{ records: number; thin: boolean; scoreWithoutRules: boolean } | null>(null);
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [validation, setValidation] = useState<{ v: Validation; jsonata: string; python: string; mapped: Json[] } | null>(null);
  const [hide, setHide] = useState(false);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // ---------- samples
  const load = useCallback(async (list: { name: string; text: string }[]) => {
    setError(null); setBusy('Reading the samples…'); setRecs([]); setTarget(null); setValidation(null);
    try {
      const r = await call<'loaded'>({ type: 'load', files: list });
      setLoaded(r);
      setFiles(list);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }, []);

  const onFiles = async (fl: FileList | null) => {
    if (!fl?.length) return;
    const list = await Promise.all([...fl].map(async (f) => ({ name: f.name, text: await f.text() })));
    setSampleNote(null);
    await load(list);
  };

  const trySample = async (id: string) => {
    const s = SAMPLES.find((x) => x.id === id)!;
    setKind('schema'); setTargetText(s.target); setPasted(''); setSampleNote(s.source);
    await load([{ name: s.file, text: s.text }]);
    await run('schema', s.target);
  };

  // ---------- target and recommendation
  useEffect(() => {
    if (kind !== 'example' || !targetText.trim()) { setInferred(null); return; }
    const t = setTimeout(() => { call<'inferred'>({ type: 'infer', text: targetText, loosen }).then((r) => setInferred(r.schema), () => setInferred(null)); }, 250);
    return () => clearTimeout(t);
  }, [kind, targetText, loosen]);

  const run = async (k = kind, text = targetText) => {
    setError(null); setBusy('Scoring every field…'); setValidation(null);
    try {
      const r = await call<'recommended'>({ type: 'recommend', kind: k, text, loosen });
      setTarget(r.target); setRecs(r.recs); setMeta({ records: r.records, thin: r.thin, scoreWithoutRules: r.scoreWithoutRules });
      const d = new Map<string, Decision>();
      for (const x of r.recs) d.set(x.field.id, { candidate: x.chosen, by: 'rule', approved: false, rejected: false });
      setDecisions(d);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const loadPasted = () => load([{ name: 'pasted', text: pasted }]);

  // ---------- decisions → mappings
  const mappings = useMemo<FieldMapping[]>(() => {
    const out: FieldMapping[] = [];
    for (const r of recs) {
      if (r.field.context) continue;
      const d = decisions.get(r.field.id);
      if (!d?.approved || !d.candidate) continue;
      if (r.field.kind === 'object_array' && d.candidate.mapping.source.op === 'nested') {
        const kids = recs.filter((k) => k.field.context?.join('.') === r.field.path.join('.'));
        const fields = kids.map((k) => decisions.get(k.field.id)).filter((x): x is Decision => !!x?.approved && !!x.candidate).map((x) => x.candidate!.mapping);
        if (fields.length) out.push({ ...d.candidate.mapping, source: { ...d.candidate.mapping.source, fields } });
        continue;
      }
      out.push(d.candidate.mapping);
    }
    return out;
  }, [recs, decisions]);

  const header = useMemo(() => `Field Map ${TOOL_VERSION} (jsonata ${JSONATA_VERSION}). Generated from fieldmap.yml; edit that file and regenerate rather than editing this one.`, []);

  useEffect(() => {
    if (!target) return;
    const t = setTimeout(() => {
      call<'validated'>({ type: 'validate', mappings, header }).then((r) => setValidation({ v: r.validation, jsonata: r.jsonata, python: r.python, mapped: r.mapped }), (e) => setError((e as Error).message));
    }, 150);
    return () => clearTimeout(t);
  }, [mappings, target, header]);

  const setDecision = (id: string, patch: Partial<Decision>) => setDecisions((m) => { const n = new Map(m); n.set(id, { ...(n.get(id) ?? { candidate: null, by: 'rule', approved: false, rejected: false }), ...patch }); return n; });

  const approveConfident = () => setDecisions((m) => {
    const n = new Map(m);
    for (const r of recs) if (r.status === 'confident' && !n.get(r.field.id)?.rejected) n.set(r.field.id, { ...n.get(r.field.id)!, approved: true });
    return n;
  });

  const arraysChosen = useMemo(() => {
    const a: Record<string, Path> = {};
    for (const r of recs) if (r.field.kind === 'object_array') { const c = decisions.get(r.field.id)?.candidate ?? r.candidates[0]; if (c?.mapping.source.op === 'nested') a[r.field.id] = c.mapping.source.array; }
    return a;
  }, [recs, decisions]);

  // ---------- exports
  const exportYml = async () => {
    const recordsHash = await sha256(files.map((f) => `${f.name}\n${f.text}`).join('\n'));
    const fields: FieldDecision[] = [];
    for (const m of mappings) {
      const r = recs.find((x) => x.field.context === null && x.field.path.join('.') === m.target.join('.'))!;
      const d = decisions.get(r.field.id)!;
      const parts = (c: Candidate | null) => (c ? Object.fromEntries(c.parts.map((p) => [p.name, p.points])) : undefined);
      const entry: FieldDecision = { target: r.field.id, mapping: m, score: d.candidate?.score ?? null, parts: parts(d.candidate), proposed_by: d.by, ...(d.answer ? { answer: d.answer } : {}) };
      if (r.field.kind === 'object_array') {
        entry.children = recs.filter((k) => k.field.context?.join('.') === r.field.path.join('.')).map((k) => ({ k, d: decisions.get(k.field.id)! })).filter(({ d: x }) => x.approved && x.candidate)
          .map(({ k, d: x }) => ({ target: k.field.id, score: x.candidate!.score, parts: parts(x.candidate), proposed_by: x.by, ...(x.answer ? { answer: x.answer } : {}) }));
      }
      fields.push(entry);
    }
    const unmapped = recs.filter((r) => !decisions.get(r.field.id)?.approved).map((r) => r.field.id);
    const text = writeFieldMap({ field_map: 1, tool_version: TOOL_VERSION, jsonata_version: JSONATA_VERSION, target: { kind: target!.kind, hash: await sha256(targetText) }, samples: { records: loaded?.records ?? 0, hash: recordsHash }, thresholds: { T, G }, fields, unmapped });
    download('fieldmap.yml', text, 'text/yaml');
  };

  const counts = useMemo(() => ({
    confident: recs.filter((r) => r.status === 'confident').length,
    question: recs.filter((r) => r.status === 'question').length,
    none: recs.filter((r) => r.status === 'no_source').length,
    approved: [...decisions.values()].filter((d) => d.approved).length,
  }), [recs, decisions]);

  return (
    <main className={`page${hide ? ' hide-values' : ''}`}>
      <header>
        <h1>Field Map</h1>
        <p className="lede">Paste a few responses from an API and the shape you need. Field Map says where each field should come from, shows you why, and asks when it isn't sure. You get a transform you can keep.</p>
        <p className="privacy">It runs in your browser. Your data doesn't leave it unless you turn on a model below, and then only what the payload panel shows.</p>
      </header>

      <section aria-labelledby="h-samples">
        <h2 id="h-samples">1. Sample responses</h2>
        <div className={`drop${dragging ? ' is-dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void onFiles(e.dataTransfer.files); }}>
          <div className="drop-actions">
            {SAMPLES.map((s) => <button key={s.id} type="button" className={s.id === 'orders' ? 'primary' : ''} onClick={() => void trySample(s.id)}>Try {s.label}</button>)}
            <label className="button">Choose JSON files<input type="file" accept=".json,.ndjson,.jsonl,.geojson,application/json" multiple onChange={(e) => void onFiles(e.target.files)} /></label>
          </div>
          <p className="hint">Or drop files here: JSON (one response or an array) or NDJSON. Up to 50 files and 50 MB.</p>
          <label htmlFor="paste" className="small">Or paste responses</label>
          <textarea id="paste" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"id": 1, "customer": {"email": "a@example.com"}}' />
          <button type="button" onClick={() => void loadPasted()} disabled={!pasted.trim()}>Use the pasted text</button>
          {loaded && (
            <div role="status" className="loaded">
              <p className="status">{loaded.records} {loaded.records === 1 ? 'record' : 'records'} from {loaded.files.length} {loaded.files.length === 1 ? 'file' : 'files'}.</p>
              {loaded.files.filter((f) => f.recordRoot).map((f) => <p key={f.name} className="small muted">{f.name}: records read from <code>{f.recordRoot!.join('.')}</code>.</p>)}
              {loaded.thin && <p className="warn small">Fewer than 3 distinct records, so nothing can be confirmed from them. You'll get questions instead of proposals.</p>}
              {loaded.bigIntPaths.length > 0 && <p className="small">Some numbers are too big for JavaScript to keep exactly, so they're read as text: <code>{loaded.bigIntPaths.slice(0, 4).join(', ')}</code>.</p>}
              {sampleNote && <p className="small muted">{sampleNote}</p>}
            </div>
          )}
          {loaded && loaded.errors.length > 0 && <ul className="errors">{loaded.errors.map((e) => <li key={e.name}><strong>{e.name}</strong>: {e.reason}</li>)}</ul>}
        </div>
      </section>

      <section aria-labelledby="h-target">
        <h2 id="h-target">2. The shape you need</h2>
        <fieldset className="kinds">
          <legend className="small">Describe it with</legend>
          {(Object.keys(KIND_LABEL) as TargetKind[]).map((k) => (
            <label key={k} className="kind"><input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} /> {KIND_LABEL[k]}</label>
          ))}
        </fieldset>
        <p className="hint small">{KIND_HINT[kind]}</p>
        <label htmlFor="target" className="sr-only">Target</label>
        <textarea id="target" rows={kind === 'columns' ? 6 : 12} value={targetText} onChange={(e) => setTargetText(e.target.value)} spellCheck={false} />
        {kind === 'example' && inferred && (
          <details className="inferred" open>
            <summary>The schema this example implies</summary>
            <div className="loosen">
              <label><input type="checkbox" checked={!!loosen.intAsNumber} onChange={(e) => setLoosen({ ...loosen, intAsNumber: e.target.checked })} /> Whole numbers can be any number</label>
              <label><input type="checkbox" checked={!!loosen.nullable} onChange={(e) => setLoosen({ ...loosen, nullable: e.target.checked })} /> Any field can be null</label>
              <label><input type="checkbox" checked={!!loosen.optional} onChange={(e) => setLoosen({ ...loosen, optional: e.target.checked })} /> No field is required</label>
            </div>
            <pre tabIndex={0}>{inferred}</pre>
          </details>
        )}
        <p><button type="button" className="primary" disabled={!loaded?.records || !targetText.trim() || !!busy} onClick={() => void run()}>Recommend a mapping</button></p>
      </section>

      {busy && <p role="status" className="status">{busy}</p>}
      {error && <p role="alert" className="warn">{error}</p>}

      {target && recs.length > 0 && meta && (
        <section aria-labelledby="h-map">
          <h2 id="h-map">3. Where each field comes from</h2>
          <p className="summary">
            {recs.length} fields. {counts.confident} confident, {counts.question} {counts.question === 1 ? 'question' : 'questions'} for you, {counts.none} with nothing in the samples that fits.
            {meta.scoreWithoutRules && ' A column list has no types or rules, so scores here come from names and what the values look like.'}
          </p>
          <p className="small muted">Scores are a heuristic out of 100, not a probability. Under {T}, or within {G} points of the runner-up, it asks instead of picking.</p>
          <div className="toolbar">
            <button type="button" onClick={approveConfident} disabled={counts.confident === 0}>Approve the {counts.confident} confident fields</button>
            <label className="toggle"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Hide values (for screen-sharing)</label>
          </div>
          <ol className="fields">
            {recs.map((r) => (
              <FieldRow key={r.field.id} rec={r} decision={decisions.get(r.field.id)!} parentApproved={!r.field.context || !!decisions.get(recs.find((p) => p.field.kind === 'object_array' && p.field.path.join('.') === r.field.context!.join('.'))?.field.id ?? '')?.approved}
                onDecide={(patch) => setDecision(r.field.id, patch)}
                onEdit={async (m) => {
                  const ctx = r.field.context ? arraysChosen[`${r.field.context.join('.')}[]`] ?? null : null;
                  const res = await call<'scored'>({ type: 'score', field: r.field.id, mapping: m, sourceContext: ctx });
                  setDecision(r.field.id, { candidate: res.candidate, by: 'user', approved: true, rejected: false });
                }} />
            ))}
          </ol>
        </section>
      )}

      {validation && target && (
        <ValidationPanel v={validation.v} target={target} approved={counts.approved} />
      )}

      {validation && target && (
        <section aria-labelledby="h-out">
          <h2 id="h-out">5. Take it with you</h2>
          {mappings.length === 0 ? <p className="hint">Approve at least one field and the downloads fill in.</p> : (
            <>
              <p>The transform is plain JSONata {JSONATA_VERSION}: it runs anywhere JavaScript runs, without this tool. The Python version gives the same output (it's tested against the JSONata on every fixture). <code>fieldmap.yml</code> records every decision and regenerates the same transform.</p>
              <div className="drop-actions">
                <button type="button" className="primary" onClick={() => void exportYml()}>fieldmap.yml</button>
                <button type="button" onClick={() => download('transform.jsonata', validation.jsonata)}>transform.jsonata</button>
                <button type="button" onClick={() => download('transform.py', validation.python, 'text/x-python')}>transform.py</button>
                <button type="button" onClick={() => download('mapped.json', JSON.stringify(validation.mapped, null, 2) + '\n', 'application/json')}>Mapped records (JSON)</button>
                {!target.fields.some((f) => f.kind !== 'scalar') && <button type="button" onClick={() => download('mapped.csv', toCsv(validation.mapped), 'text/csv')}>Mapped records (CSV)</button>}
              </div>
              <details><summary>See the JSONata</summary><pre tabIndex={0} className="code">{validation.jsonata}</pre></details>
              <details><summary>See the first mapped record</summary><pre tabIndex={0} className="code values">{JSON.stringify(canonical(validation.mapped[0]) ?? {}, null, 2)}</pre></details>
            </>
          )}
        </section>
      )}

      {target && recs.length > 0 && <AiPanel recs={recs} arrays={arraysChosen} onAccept={(field, c) => setDecision(field, { candidate: c, by: 'llm', approved: false, rejected: false })} />}

      <footer className="small muted">
        <p>Field Map {TOOL_VERSION}. One of the data tools at pettigrewlab.com. Every proposal is compiled from a small closed grammar and run on your samples before you see it.</p>
      </footer>
    </main>
  );
}

function Score({ c }: { c: Candidate }) {
  return (
    <details className="parts">
      <summary><span className="score-n">{c.score}</span><span className="score-l">score</span></summary>
      <ul>{c.parts.map((p) => <li key={p.name}><strong>{p.name}</strong> {p.points}/{p.of}: {p.why}</li>)}</ul>
    </details>
  );
}

function Examples({ c }: { c: Candidate }) {
  if (!c.examples.length) return null;
  return (
    <table className="samples values">
      <caption>On your samples</caption>
      <thead><tr><th scope="col">Before</th><th scope="col">After</th></tr></thead>
      <tbody>{c.examples.map((e, i) => <tr key={i}><td>{e.before}</td><td>{e.after}</td></tr>)}</tbody>
    </table>
  );
}

function Chips({ c }: { c: Candidate }) {
  const ts = c.mapping.transforms;
  if (!ts.length && !c.flags.length) return null;
  return <p className="chips">{ts.map((t, i) => <span key={i} className="chip">{transformLabel(t)}</span>)}{c.flags.filter((f) => !f.startsWith('read as')).map((f) => <span key={f} className="chip flag">{f}</span>)}</p>;
}

function FieldRow({ rec, decision, parentApproved, onDecide, onEdit }: { rec: FieldRec; decision: Decision; parentApproved: boolean; onDecide: (p: Partial<Decision>) => void; onEdit: (m: FieldMapping) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [pathText, setPathText] = useState('');
  const [constant, setConstant] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const c = decision.candidate;
  const f = rec.field;
  const nested = !!f.context;
  const cls = `field${nested ? ' nested' : ''}${decision.approved ? ' is-approved' : ''}${decision.rejected ? ' is-rejected' : ''} status-${rec.status}`;
  const submitPath = async () => {
    setEditError(null);
    try { await onEdit({ target: f.path, source: { op: 'path', path: parsePath(pathText) }, transforms: c?.mapping.transforms ?? [] }); setEditing(false); } catch (e) { setEditError((e as Error).message); }
  };
  const submitConstant = async () => {
    setEditError(null);
    const v = constant.trim() === '' ? null : /^-?\d+(\.\d+)?$/.test(constant.trim()) && f.type !== 'string' ? Number(constant) : constant === 'true' ? true : constant === 'false' ? false : constant;
    await onEdit({ target: f.path, source: { op: 'constant', value: v }, transforms: [] });
    setEditing(false);
  };
  return (
    <li className={cls}>
      <div className="card-head">
        <div>
          <h3><code>{f.id}</code>{f.required && <span className="tag">required</span>}</h3>
          <p className="on">
            {decision.rejected ? 'Rejected. It stays out of the transform.' :
              c ? <>from <code>{c.sourceId}</code>{decision.by === 'user' ? ' (your choice)' : decision.by === 'llm' ? ' (model draft, checked)' : ''}</> :
              rec.status === 'question' ? 'Needs your answer.' : rec.note ?? 'Nothing fits.'}
          </p>
          {nested && !parentApproved && <p className="small muted">Inside <code>{f.context!.join('.')}[]</code>: approve that list too, or this field has nowhere to go.</p>}
        </div>
        {c && <Score c={c} />}
      </div>

      {c && !decision.rejected && <><Chips c={c} /><p className="reason small">{c.reason.charAt(0).toUpperCase() + c.reason.slice(1)}{c.ruleFit ? `. ${c.ruleFit.pass} of ${c.ruleFit.of} pass the target's rules.` : ''}</p><Examples c={c} /></>}

      {rec.status === 'question' && rec.question && !decision.approved && (
        <fieldset className="question">
          <legend>{rec.question.text}</legend>
          {rec.question.options.map((o, i) => (
            <label key={i} className="option">
              <input type="radio" name={`q-${f.id}`} checked={decision.candidate === o.candidate} onChange={() => onDecide({ candidate: o.candidate, by: 'user', answer: `${rec.question!.text} → ${o.label}` })} />
              <span><strong>{o.label}</strong> <span className="muted small">({o.candidate.score})</span><span className="values small"> {o.samples.map((s) => <code key={s}>{s}</code>)}</span></span>
            </label>
          ))}
        </fieldset>
      )}

      {rec.status === 'no_source' && rec.candidates.length > 0 && !c && (
        <div className="near small">
          <p>Closest, and why each one doesn't fit:</p>
          <ul>{rec.candidates.slice(0, 3).map((x) => <li key={x.sourceId}><code>{x.sourceId}</code> ({x.score}): {x.parts.slice().sort((a, b) => a.points / a.of - b.points / b.of)[0].why}</li>)}</ul>
        </div>
      )}

      <div className="actions">
        {c && !decision.approved && <button type="button" className="primary" onClick={() => onDecide({ approved: true, rejected: false })}>Approve</button>}
        {decision.approved && <button type="button" onClick={() => onDecide({ approved: false })}>Undo approval</button>}
        {!decision.rejected ? <button type="button" onClick={() => onDecide({ rejected: true, approved: false })}>Reject</button> : <button type="button" onClick={() => onDecide({ rejected: false })}>Undo reject</button>}
        <button type="button" className="quiet" aria-expanded={editing} onClick={() => setEditing(!editing)}>Edit</button>
      </div>
      {editing && (
        <div className="edit">
          {rec.candidates.length > 1 && (
            <label>Another candidate{' '}
              <select onChange={(e) => { const x = rec.candidates[Number(e.target.value)]; if (x) { onDecide({ candidate: x, by: 'user', approved: true, rejected: false }); setEditing(false); } }} defaultValue="">
                <option value="" disabled>Pick one</option>
                {rec.candidates.map((x, i) => <option key={i} value={i}>{x.sourceId} ({x.score})</option>)}
              </select>
            </label>
          )}
          {f.kind === 'scalar' && (
            <>
              <label>Or type a source path{' '}<input value={pathText} onChange={(e) => setPathText(e.target.value)} placeholder="customer.email" onKeyDown={(e) => { if (e.key === 'Enter') void submitPath(); }} /></label>
              <button type="button" onClick={() => void submitPath()} disabled={!pathText.trim()}>Use it</button>
              <label>Or a fixed value{' '}<input value={constant} onChange={(e) => setConstant(e.target.value)} placeholder="USD" /></label>
              <button type="button" onClick={() => void submitConstant()}>Set it</button>
            </>
          )}
          {editError && <p className="warn small">{editError}</p>}
        </div>
      )}
    </li>
  );
}

function ValidationPanel({ v, target, approved }: { v: Validation; target: Target; approved: number }) {
  const failing = v.fields.filter((f) => f.pass < f.of);
  return (
    <section aria-labelledby="h-check">
      <h2 id="h-check">4. Checked against the target</h2>
      {approved === 0 ? <p className="hint">Nothing approved yet. Approve fields and each one is run over every sample and checked here.</p> : !target.schema ? (
        <p>A column list has no rules to check. Of {v.records} records, here's how often each field is filled: {v.fields.filter((f) => f.field.indexOf('[]') < 0).map((f) => `${f.field} ${f.pass}`).join(', ')}.</p>
      ) : (
        <>
          <p className="status">{v.passing} of {v.records} mapped records pass the target schema.</p>
          {failing.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Field</th><th scope="col" className="num">Pass</th><th scope="col">Why some fail</th></tr></thead>
                <tbody>{failing.map((f) => <tr key={f.field}><td><code>{f.field}</code></td><td className="num">{f.pass} of {f.of}</td><td>{[...new Set(f.failures.map((x) => x.reason))].slice(0, 2).join('; ')}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {failing.length > 0 && <p className="small muted">Unmapped required fields fail every record until you map them or loosen the target.</p>}
        </>
      )}
    </section>
  );
}

function AiPanel({ recs, arrays, onAccept }: { recs: FieldRec[]; arrays: Record<string, Path>; onAccept: (field: string, c: Candidate) => void }) {
  const [on, setOn] = useState(false);
  const [cfg, setCfg] = useState<ModelConfig>({ kind: 'openai-compatible', ...DEFAULTS['openai-compatible'], apiKey: '' });
  const [payload, setPayload] = useState<Payload | null>(null);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const open = useRef(false);
  useEffect(() => { if (on && !open.current) { open.current = true; void call<'payload'>({ type: 'payload' }).then((r) => setPayload(r.payload)); } }, [on]);
  useEffect(() => { if (on) void call<'payload'>({ type: 'payload' }).then((r) => setPayload(r.payload)); }, [recs, on]);
  const req = payload ? buildRequest(cfg, payload, PROMPT) : null;
  const ask = async () => {
    if (!payload) return;
    setErr(null); setAsking(true); setResult(null);
    try {
      const answer = await callModel(cfg, payload, PROMPT);
      const r = await call<'drafts'>({ type: 'drafts', answer, arrays });
      setResult(r.result);
    } catch (e) { setErr((e as Error).message); } finally { setAsking(false); }
  };
  const open_ = recs.filter((r) => r.status !== 'confident').length;
  return (
    <section aria-labelledby="h-ai" className="ai">
      <h2 id="h-ai">Ask a model for drafts (optional)</h2>
      <label className="toggle"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Use a model for the {open_} {open_ === 1 ? 'field' : 'fields'} that {open_ === 1 ? "isn't" : "aren't"} confident</label>
      {on && (
        <div className="ai-body">
          <p className="small">It's off by default and nothing is sent until you press the button. Use your own key, or a local model through an OpenAI-compatible endpoint (Ollama's is the default). The key stays in this tab's memory and is never saved.</p>
          <div className="ai-cfg">
            <label>Provider <select value={cfg.kind} onChange={(e) => { const k = e.target.value as ModelConfig['kind']; setCfg({ kind: k, ...DEFAULTS[k], apiKey: cfg.apiKey }); }}><option value="openai-compatible">OpenAI-compatible (local or hosted)</option><option value="anthropic">Anthropic</option></select></label>
            <label>Endpoint <input value={cfg.endpoint} onChange={(e) => setCfg({ ...cfg, endpoint: e.target.value })} /></label>
            <label>Model <input value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} /></label>
            <label>Key <input type="password" value={cfg.apiKey} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} autoComplete="off" /></label>
          </div>
          {req && (
            <details>
              <summary>Exactly what would be sent</summary>
              <p className="small">Names, types and profiles. Values with 50 or fewer distinct entries that aren't emails go as they are; everything else is masked by shape (9 for a digit, a and A for letters).</p>
              <pre tabIndex={0} className="code">{`POST ${req.url}\n${JSON.stringify(redact(req.headers), null, 2)}\n\n${JSON.stringify(req.body, null, 2)}`}</pre>
            </details>
          )}
          <button type="button" className="primary" disabled={!payload || asking} onClick={() => void ask()}>{asking ? 'Asking…' : 'Send it and get drafts'}</button>
          {err && <p role="alert" className="warn">{err}</p>}
          {result && (
            <div className="drafts">
              <p className="status">{result.accepted.length} drafts passed the checks, {result.rejected.length} didn't.</p>
              <ul>
                {result.accepted.map((a) => (
                  <li key={a.target}><code>{a.target}</code> from <code>{a.candidate.sourceId}</code>, scored {a.candidate.score}.{a.modelValueMap && ' Its value table is model-proposed and not checked against any docs, so check each entry.'} <button type="button" onClick={() => onAccept(a.target, a.candidate)}>Use this draft</button></li>
                ))}
                {result.rejected.map((r, i) => <li key={`r${i}`} className="muted"><code>{r.target}</code>: rejected, {r.reason}.</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

