import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadFile, profileTable, findCandidates, buildReceipt, unmatchedExamples, grainLabel,
  type TableProfile, type PairResult, type Plan, type Receipt, type LoadError, type Draft,
} from '@data-tools/core';
import { createWasmDb, type WasmDb } from './wasmDb';
import { sampleFiles } from './samples';
import { FileCard } from './components/FileCard';
import { ReceiptCard, type Card } from './components/ReceiptCard';
import { AiPanel, type AiState, defaultAi } from './components/AiPanel';
import { ExportPanel } from './components/ExportPanel';

const MAX_FILES = 10;

export function App() {
  const dbRef = useRef<WasmDb | null>(null);
  const takenRef = useRef(new Set<string>());
  const copiesRef = useRef(new Map<string, string>());
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<LoadError[]>([]);
  const [profiles, setProfiles] = useState<TableProfile[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [ai, setAi] = useState<AiState>(defaultAi);
  const [dragging, setDragging] = useState(false);
  const seq = useRef(new Map<string, number>());

  const db = async () => {
    if (!dbRef.current) {
      setStatus('Starting DuckDB in your browser…');
      dbRef.current = await createWasmDb();
    }
    return dbRef.current;
  };

  const update = (id: string, patch: Partial<Card>) => setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  /** Recompute a card's receipt. A newer edit on the same card wins; older results are dropped. */
  const recompute = useCallback(async (card: Card, plan: Plan, patch: Partial<Card> = {}, profs = profiles) => {
    const n = (seq.current.get(card.id) ?? 0) + 1;
    seq.current.set(card.id, n);
    update(card.id, { ...patch, plan, busy: true, error: undefined });
    try {
      const d = await db();
      const receipt = await buildReceipt(d, profs, plan);
      const unmatched = await unmatchedExamples(d, profs, plan, 6);
      if (seq.current.get(card.id) === n) update(card.id, { receipt, unmatched, busy: false });
    } catch (e) {
      if (seq.current.get(card.id) === n) update(card.id, { busy: false, error: e instanceof Error ? e.message.split('\n')[0] : String(e) });
    }
  }, [profiles]);

  const loadAll = async (files: { name: string; bytes: Uint8Array }[]) => {
    setPhase('loading');
    setErrors([]);
    try {
      const d = await db();
      const errs: LoadError[] = [];
      const profs = [...profiles];
      if (profs.length + files.length > MAX_FILES) {
        errs.push({ ok: false, file: `${files.length} files`, error: `Join Receipt handles up to ${MAX_FILES} files at once.` });
        files = files.slice(0, Math.max(0, MAX_FILES - profs.length));
      }
      for (const f of files) {
        setStatus(`Loading ${f.name}…`);
        const r = await loadFile(d, f.name, f.bytes, takenRef.current);
        if (!r.ok) { errs.push(r); continue; }
        setStatus(`Profiling ${f.name}…`);
        const prof = await profileTable(d, r.name, r.file);
        if (r.copy) copiesRef.current.set(r.copy.file, r.copy.text);
        profs.push({
          ...prof,
          ...(r.sheet && r.copy ? { sheet: r.sheet, readFrom: r.copy.file } : {}),
          ...(r.encoding ? { encoding: r.encoding } : {}),
          ...(r.delimiter ? { delimiter: r.delimiter } : {}),
          ...(r.warning ? { warning: r.warning } : {}),
        });
      }
      setErrors(errs);
      setProfiles(profs);
      setStatus('Looking for the columns that connect them…');
      const { pairs } = profs.length >= 2 ? await findCandidates(d, profs) : { pairs: [] as PairResult[] };
      const next: Card[] = pairs.map((pair) => {
        const top = pair.best[0];
        const plan: Plan | null = top ? { join: { op: 'join_on', left: top.left, right: top.right, how: 'left', ...(top.also ? { also: top.also } : {}) } } : null;
        return { id: `${pair.left}__${pair.right}`, pair, choice: 0, plan, status: 'proposed', proposedBy: 'rule', busy: !!plan, llm: null, drafts: [] };
      });
      setCards(next);
      setPhase('ready');
      setStatus('');
      // Bring the result into view: on a phone it lands well below the buttons, and nothing else says it arrived.
      requestAnimationFrame(() => {
        const h = document.getElementById(next.length ? 'joins-h' : 'files-h');
        h?.focus({ preventScroll: true });
        h?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      for (const c of next) if (c.plan && c.pair.reliable) await recompute(c, c.plan, {}, profs);
      for (const c of next) if (c.plan && !c.pair.reliable) await recompute(c, c.plan, {}, profs);
    } catch (e) {
      setErrors((es) => [...es, { ok: false, file: 'DuckDB', error: e instanceof Error ? e.message : String(e) }]);
      setPhase(profiles.length ? 'ready' : 'idle');
      setStatus('');
    }
  };

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = await Promise.all([...list].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    await loadAll(files);
  };

  const reset = () => {
    window.location.reload();
  };

  // ?sample=1 loads the sample data straight away, for screenshots and the look picker.
  const autoloaded = useRef(false);
  useEffect(() => {
    if (autoloaded.current || new URLSearchParams(location.search).get('sample') !== '1') return;
    autoloaded.current = true;
    void loadAll(sampleFiles());
  }, []);

  const onDrafts = (id: string, drafts: Draft[], llm: Card['llm']) => update(id, { drafts, llm });

  return (
    <div className="page">
      <header className="masthead">
        <h1>Join Receipt</h1>
        <p className="lede">
          Drop in two files and it finds the column that joins them. Then it tells you what the join costs: how many rows matched,
          what the ones that didn't have in common, and whether anything gets counted twice. You check its pick, change it if
          it's wrong, and take the fix with you as SQL or pandas code.
        </p>
        <p className="privacy">
          Your files stay in this browser. Nothing is uploaded. There's an optional helper that drafts cleanup steps with an AI
          model, but it's off until you connect one, it shows you exactly what it would send first, and it never picks the join.
        </p>
      </header>

      <section
        className={`drop ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void onFiles(e.dataTransfer.files); }}
        aria-label="Add files"
      >
        <div className="drop-actions">
          <button className="primary" disabled={phase === 'loading'} onClick={() => {
            // The sample replaces whatever is loaded; mixing it with your own files only adds noise pairs.
            if (profiles.length) location.assign('?sample=1');
            else void loadAll(sampleFiles());
          }}>Try the sample data</button>
          <label className={`button ${phase === 'loading' ? 'is-disabled' : ''}`}>
            Add your files
            <input type="file" multiple accept=".csv,.tsv,.txt,.parquet,.json,.ndjson,.jsonl,.xlsx" disabled={phase === 'loading'} onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
          </label>
          {profiles.length > 0 && <button className="quiet" onClick={reset}>Start over</button>}
        </div>
        <p className="hint">Or drop CSV, Excel, Parquet or JSON files here, 2 to 10 of them. On a phone, the sample is the quick way to see it.</p>
        {status && <p className="status" role="status">{status}</p>}
        {errors.length > 0 && (
          <ul className="errors" role="alert">
            {errors.map((e, i) => <li key={i}><strong>{e.file}</strong> didn't load: {e.error}</li>)}
          </ul>
        )}
      </section>

      {profiles.length === 0 && phase !== 'loading' && (
        <section aria-labelledby="example-h">
          <h2 id="example-h">What you get back</h2>
          <article className="card example">
            <p className="example-on">counties.csv joined to unemployment_2024.csv on the county FIPS code</p>
            <div className="paper">
              <dl>
                <div><dt>Matched</dt><dd>208 of 216 counties</dd></div>
                <div><dt>Didn't match</dt><dd>8 rows. <span className="pattern">All 8 have state = AK.</span></dd></div>
                <div><dt>Cleanup</dt><dd>One file had dropped the leading zero (1001 for 01001). Zero-padding to 5 took the match rate from 81.9% to 96.3%.</dd></div>
                <div><dt>Double counting</dt><dd>None on this join. On the daily visits file it multiplies rows, and it offers to roll the file up first.</dd></div>
              </dl>
            </div>
            <p className="hint">
              That's the sample data. Try it and you get this receipt for every pair of files, plus the joined CSV, the SQL, the
              pandas code and a small file that records every choice, so the same join runs the same way next month.
            </p>
          </article>
        </section>
      )}

      {profiles.length > 0 && (
        <section aria-labelledby="files-h">
          <h2 id="files-h" tabIndex={-1}>What's in your files</h2>
          <div className="files">{profiles.map((p) => <FileCard key={p.table} profile={p} grain={grainLabel(p)} />)}</div>
          {profiles.length === 1 && <p className="hint">Add at least one more file to look for joins.</p>}
        </section>
      )}

      {cards.length > 0 && (
        <section aria-labelledby="joins-h">
          <h2 id="joins-h" tabIndex={-1}>Proposed joins</h2>
          <p className="hint">Best first. Change the key, the cleanup or the join type and the receipt recalculates.</p>
          <div className="cards">
            {cards.map((c) => (
              <ReceiptCard
                key={c.id} card={c} profiles={profiles} ai={ai}
                onPlan={(plan, patch) => void recompute(c, plan, { proposedBy: 'user', llm: null, status: 'proposed', ...patch })}
                onStatus={(s) => update(c.id, { status: s })}
                onDrafts={(d, llm) => onDrafts(c.id, d, llm)}
                db={() => db()}
              />
            ))}
          </div>
        </section>
      )}

      {profiles.length >= 2 && <AiPanel ai={ai} setAi={setAi} />}

      {cards.length > 0 && <ExportPanel cards={cards} profiles={profiles} db={() => db()} copies={copiesRef.current} />}

      <footer className="foot">
        <p>
          Free and open source (MIT). <a href="https://github.com/pettigrewlabllc/data-tools">The code is on GitHub</a>.
          Made by <a href="https://pettigrewlab.com">Pettigrew Lab</a>. Every number on this page comes from SQL run by DuckDB, in your browser.
        </p>
      </footer>
    </div>
  );
}

export type { Receipt };
