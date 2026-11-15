import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadFile, profileTable, tableNameFor, parseDdl, classifyPersonal, draftPolicy, draftWithModel, importFides, importDpv,
  policyFromTicked, policyFromYaml, policyToYaml, checkCollection, applyToFacts, plannedNoticeCategories, checkCombination,
  createView, measureUniqueness, findRiskySubsets, suggestLink, CONFIRM_BELOW, getCategory, labelOf,
  type Choices, type OptionId, type Policy, type LoadError, type TableProfile,
} from '@data-tools/core';
import { createWasmDb, type WasmDb } from './wasmDb';
import { C } from './copy';
import { SAMPLE_NOTICE, sampleFiles } from './samples';
import { combinedSelect, factsFor, withPlanned, colKey, type Confirmed, type Overrides, type TableState } from './analysis';
import { NoticeStep } from './components/NoticeStep';
import { DataStep } from './components/DataStep';
import { FindingsStep } from './components/FindingsStep';
import { CombineStep, type Combo, type UniqueOut } from './components/CombineStep';
import { defaultAi, type AiState } from './components/AiPanel';

const MAX_FILES = 10;

function saveText(name: string, text: string, type = 'text/yaml') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const dbRef = useRef<WasmDb | null>(null);
  const takenRef = useRef(new Set<string>());

  // step 1
  const [notice, setNotice] = useState('');
  const [policy, setPolicyRaw] = useState<Policy | null>(null);
  const [policyConfirmed, setPolicyConfirmed] = useState(false);
  const [unrecognised, setUnrecognised] = useState<string[]>([]);
  const [policyError, setPolicyError] = useState('');
  const [ai, setAi] = useState<AiState>(defaultAi);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  // step 2
  const [tables, setTables] = useState<TableState[]>([]);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [confirmed, setConfirmed] = useState<Confirmed>({});
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<LoadError[]>([]);
  const [busy, setBusy] = useState(false);
  const [ddlMessage, setDdlMessage] = useState('');
  // step 3
  const [choices, setChoices] = useState<Choices>({});
  // step 4
  const [combo, setCombo] = useState<Combo>({ selected: [], links: {}, suggested: {}, qiOff: {} });
  const [unique, setUnique] = useState<UniqueOut>({ busy: false, error: '', entityLabel: C.uniqueEntityRows, qi: [], direct: [] });
  const [combination, setCombination] = useState<ReturnType<typeof checkCombination> | null>(null);
  const seenTables = useRef(new Set<string>());

  const db = async () => {
    if (!dbRef.current) { setStatus('Starting DuckDB in your browser...'); dbRef.current = await createWasmDb(); }
    return dbRef.current;
  };

  const setPolicy = (p: Policy) => { setPolicyRaw(p); setPolicyConfirmed(false); };

  // ---- step 1 actions ----
  const draft = () => { setPolicy(draftPolicy(notice)); setUnrecognised([]); setPolicyError(''); };
  const importFile = async (f: File) => {
    try {
      const text = await f.text();
      const r = /\.(json|jsonld)$/i.test(f.name) || text.trim().startsWith('{') ? importDpv(text) : importFides(text);
      setPolicy(r.policy); setUnrecognised(r.unrecognised); setPolicyError('');
    } catch (e) { setPolicyError(`${f.name}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const openPolicy = async (f: File) => {
    try {
      const p = policyFromYaml(await f.text());
      setPolicy(p); setUnrecognised([]); setPolicyError('');
      if (p.sentences.length) {
        const byPara = new Map<number, string[]>();
        for (const s of p.sentences) byPara.set(s.paragraph, [...(byPara.get(s.paragraph) ?? []), s.text]);
        setNotice([...byPara.values()].map((x) => x.join(' ')).join('\n\n'));
      }
    } catch (e) { setPolicyError(`${f.name}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const runAi = async () => {
    setAiBusy(true); setAiMessage('');
    try {
      const r = await draftWithModel(ai, notice);
      setPolicy(r.policy); setUnrecognised([]);
      setAiMessage(r.rejected.join(' '));
    } catch (e) { setAiMessage(C.aiFailed(e instanceof Error ? e.message : String(e))); }
    setAiBusy(false);
  };

  // ---- step 2 actions ----
  const addProfiled = (profs: { profile: TableProfile; file: string }[]) => {
    const next: TableState[] = profs.map(({ profile, file }) => ({
      name: profile.table, file, source: 'file', rows: profile.rows, profile,
      columns: profile.columns.map((c) => ({ name: c.name, type: c.type, proposal: classifyPersonal({ name: c.name, type: c.type, samples: c.samples, table: profile.table }) })),
    }));
    setTables((t) => [...t, ...next]);
  };
  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const files = await Promise.all([...list].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    await loadAll(files);
  };
  const loadAll = async (files: { name: string; bytes: Uint8Array }[]) => {
    setBusy(true); setErrors([]);
    const errs: LoadError[] = [];
    try {
      const d = await db();
      const room = Math.max(0, MAX_FILES - tables.filter((t) => t.source === 'file').length);
      if (files.length > room) { errs.push({ ok: false, file: `${files.length} files`, error: `PrivacyDiff handles up to ${MAX_FILES} files at once.` }); files = files.slice(0, room); }
      const done: { profile: TableProfile; file: string }[] = [];
      for (const f of files) {
        setStatus(C.loading(f.name));
        const r = await loadFile(d, f.name, f.bytes, takenRef.current);
        if (!r.ok) { errs.push(r); continue; }
        done.push({ profile: await profileTable(d, r.name, r.file), file: f.name });
      }
      addProfiled(done);
    } catch (e) { errs.push({ ok: false, file: 'DuckDB', error: e instanceof Error ? e.message : String(e) }); }
    setErrors(errs); setStatus(''); setBusy(false);
  };
  const onDdl = (text: string) => {
    const found = parseDdl(text);
    if (!found.length) { setDdlMessage(C.ddlNone); return; }
    setDdlMessage('');
    setTables((t) => [...t, ...found.map((x) => {
      const name = tableNameFor(x.name, takenRef.current);
      return { name, file: x.name, source: 'ddl' as const, columns: x.columns.map((c) => ({ name: c.name, type: c.type, proposal: classifyPersonal({ name: c.name, type: c.type, table: name }) })) };
    })]);
  };
  const setOverride = (key: string, category: string | null) => { setOverrides((o) => ({ ...o, [key]: category })); };
  const confirm = (keys: string[]) => setConfirmed((c) => ({ ...c, ...Object.fromEntries(keys.map((k) => [k, true as const])) }));

  const sample = async () => {
    setNotice(SAMPLE_NOTICE); setPolicy(draftPolicy(SAMPLE_NOTICE)); setUnrecognised([]); setPolicyError('');
    if (!tables.some((t) => t.file === 'members.csv')) await loadAll(sampleFiles());
  };
  const autoloaded = useRef(false);
  useEffect(() => {
    if (autoloaded.current || new URLSearchParams(location.search).get('sample') !== '1') return;
    autoloaded.current = true;
    void sample();
  }, []);

  // ---- derived ----
  const ready = !!policy && policyConfirmed;
  const facts = useMemo(() => factsFor(tables, overrides, confirmed), [tables, overrides, confirmed]);
  const before = useMemo(() => (ready && policy ? checkCollection(facts, policy) : []), [ready, policy, facts]);
  const afterFacts = useMemo(() => applyToFacts(facts, choices), [facts, choices]);
  const after = useMemo(() => (ready && policy ? checkCollection(afterFacts, withPlanned(policy, plannedNoticeCategories(facts, choices))) : []), [ready, policy, afterFacts, facts, choices]);
  const setChoice = (key: string, id: OptionId | null) => setChoices((c) => { const n = { ...c }; if (id) n[key] = id; else delete n[key]; return n; });

  // ---- step 4: selection and suggested keys ----
  useEffect(() => {
    const fresh = tables.map((t) => t.name).filter((n) => !seenTables.current.has(n));
    if (!fresh.length) return;
    fresh.forEach((n) => seenTables.current.add(n));
    setCombo((c) => ({ ...c, selected: [...c.selected, ...fresh] }));
  }, [tables]);

  const selKey = combo.selected.join('|');
  useEffect(() => {
    const sel = combo.selected.map((n) => tables.find((t) => t.name === n)).filter(Boolean) as TableState[];
    const base = sel[0];
    if (!base?.profile) return;
    const missing = sel.slice(1).filter((t) => t.profile && !combo.links[t.name]);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const d = await db();
      for (const t of missing) {
        const s = await suggestLink(d, base.profile!, t.profile!);
        if (cancelled) return;
        if (s) setCombo((c) => (c.links[t.name] ? c : { ...c, links: { ...c.links, [t.name]: { base: s.left, other: s.right } }, suggested: { ...c.suggested, [t.name]: true } }));
      }
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [selKey, tables]);

  // ---- step 4: the combination (categories only) ----
  useEffect(() => {
    const sel = combo.selected.map((n) => tables.find((t) => t.name === n)).filter(Boolean) as TableState[];
    if (!ready || sel.length < 2) { setCombination(null); return; }
    const counted = afterFacts.filter((f) => f.confirmed || f.confidence >= CONFIRM_BELOW);
    setCombination(checkCombination(sel.map((t) => ({ table: t.file, categories: counted.filter((f) => f.table === t.name).map((f) => f.category) }))));
  }, [ready, selKey, tables, afterFacts]);

  // ---- step 4: uniqueness on the data ----
  const runId = useRef(0);
  const linksKey = JSON.stringify(combo.links), offKey = JSON.stringify(combo.qiOff), choicesKey = JSON.stringify(choices), ovKey = JSON.stringify(overrides);
  useEffect(() => {
    const picked = combo.selected.map((n) => tables.find((t) => t.name === n)).filter((t): t is TableState => !!t && t.source === 'file');
    if (!ready || !picked.length) { setUnique((u) => ({ ...u, busy: false, result: undefined, subsets: undefined, qi: [], direct: [] })); return; }
    const base = picked[0];
    const sel = [base, ...picked.slice(1).filter((t) => combo.links[t.name]?.base && combo.links[t.name]?.other)];
    const id = ++runId.current;
    setUnique((u) => ({ ...u, busy: true, error: '' }));
    (async () => {
      const d = await db();
      const { sql, columns } = combinedSelect(sel, combo.links, facts, choices);
      await createView(d, 'pd_combined', sql);
      const cat = (t: string, c: string) => afterFacts.find((f) => f.table === t && f.column === c)?.category;
      const qiAll = columns.filter((c) => { const k = cat(c.table, c.column); return k && getCategory(k).kind === 'quasi' && (confirmed[colKey(c.table, c.column)] || colKey(c.table, c.column) in overrides || (afterFacts.find((f) => f.table === c.table && f.column === c.column)?.confidence ?? 0) >= CONFIRM_BELOW); });
      const direct = columns.filter((c) => { const k = cat(c.table, c.column); return k && getCategory(k).kind === 'direct'; }).map((c) => `${c.table}.${c.column}`);
      const qi = qiAll.filter((c) => !combo.qiOff[c.alias]);
      const entityCol = columns.find((c) => c.table === base.name && cat(c.table, c.column) === 'user.unique_id')
        ?? (sel.length > 1 ? columns.find((c) => c.table === base.name && c.column === combo.links[sel[1].name]?.base) : undefined);
      const entity = entityCol?.alias;
      const result = await measureUniqueness(d, 'pd_combined', qi.map((c) => c.alias), entity);
      const subsets = qi.length ? await findRiskySubsets(d, 'pd_combined', qi.map((c) => c.alias), entity, 0.5, 3) : [];
      if (id !== runId.current) return;
      const pretty = (a: string) => { const c = columns.find((x) => x.alias === a); return c ? `${c.table}.${c.column}` : a; };
      setUnique({
        busy: false, error: '', entityLabel: entityCol ? `${entityCol.table}.${entityCol.column}` : C.uniqueEntityRows,
        qi: qiAll.map((c) => ({ key: c.alias, label: `${c.table}.${c.column} (${labelOf(cat(c.table, c.column)!)})` })), direct,
        result: qi.length ? result : undefined,
        subsets: subsets.map((s) => ({ ...s, columns: s.columns.map(pretty) })),
      });
    })().catch((e) => { if (id === runId.current) setUnique((u) => ({ ...u, busy: false, error: e instanceof Error ? e.message : String(e), result: undefined })); });
  }, [ready, selKey, linksKey, offKey, choicesKey, ovKey, tables, policy]);

  const download = () => policy && saveText('policy.yml', policyToYaml(policy));
  const started = !!policy || tables.length > 0;

  return (
    <div className="page">
      <header className="masthead">
        <h1>{C.title}</h1>
        <p className="lede">{C.lede}</p>
        <p className="privacy">{C.stance}</p>
        <p className="privacy">{C.privacy}</p>
        <div className="row">
          <button className="primary" onClick={() => void sample()} disabled={busy}>{C.sampleButton}</button>
          <span className="hint">{C.sampleNote}</span>
          {started && <button className="quiet" onClick={() => window.location.assign(window.location.pathname)}>{C.startOver}</button>}
        </div>
      </header>

      <NoticeStep
        notice={notice} setNotice={setNotice} policy={policy} setPolicy={setPolicy}
        confirmed={policyConfirmed} onConfirm={() => setPolicyConfirmed(true)}
        onDraft={draft} onImport={(f) => void importFile(f)} onOpenPolicy={(f) => void openPolicy(f)}
        onTick={(ids) => { setPolicy(policyFromTicked(ids)); setUnrecognised([]); }}
        unrecognised={unrecognised} error={policyError} onDownload={download}
        ai={ai} setAi={setAi} aiBusy={aiBusy} aiMessage={aiMessage} onAi={() => void runAi()}
      />

      <DataStep
        tables={tables} overrides={overrides} confirmed={confirmed} setOverride={setOverride} confirm={confirm}
        onFiles={(f) => void onFiles(f)} onDdl={onDdl} status={status} errors={errors} busy={busy} ddlMessage={ddlMessage}
      />

      <FindingsStep before={before} after={after} choices={choices} setChoice={setChoice} ready={ready} hasData={tables.length > 0} />

      <CombineStep tables={tables} combo={combo} setCombo={setCombo} combination={combination} unique={unique} hasData={tables.some((t) => t.source === 'file')} ready={ready} />

      <section aria-labelledby="s5-h" className="step">
        <h2 id="s5-h">{C.step5}</h2>
        <div className="row">
          <button onClick={download} disabled={!policyConfirmed}>{C.downloadYaml}</button>
          {!policyConfirmed && <span className="hint">{C.exportNeedsPolicy}</span>}
        </div>
      </section>

      <footer className="foot">
        <p>{C.footer} <a href="https://github.com/pettigrewlabllc/data-tools">{C.repoLink}</a></p>
      </footer>
    </div>
  );
}
