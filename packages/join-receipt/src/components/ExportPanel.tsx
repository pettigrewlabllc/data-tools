import { useState } from 'react';
import { toYaml, emitSqlScript, emitPython, joinParts, withCtes, planOf, mappingTable, TOOL, TOOL_VERSION, type Mapping, type TableProfile, type Db } from '@data-tools/core';
import type { Card } from './ReceiptCard';
import type { WasmDb } from '../wasmDb';

export function buildMapping(cards: Card[], profiles: TableProfile[]): Mapping {
  return {
    tool: TOOL,
    version: TOOL_VERSION,
    tables: profiles.map(mappingTable),
    joins: cards.filter((c) => c.plan && c.receipt && c.status !== 'proposed').map((c) => ({
      id: c.id,
      left: c.plan!.join.left, right: c.plan!.join.right, how: c.plan!.join.how,
      ...(c.plan!.join.also?.length ? { also: c.plan!.join.also } : {}),
      aggregate_left: c.plan!.aggregateLeft ?? null, aggregate_right: c.plan!.aggregateRight ?? null,
      status: c.status, proposed_by: c.proposedBy, llm: c.proposedBy === 'llm' ? c.llm : null,
      receipt: {
        matched: c.receipt!.matchedLeft, unmatched_left: c.receipt!.unmatchedLeft, unmatched_right: c.receipt!.unmatchedRight,
        joined_rows: c.receipt!.joinedRows, fanout: c.receipt!.fanout, max_per_key_right: c.receipt!.maxPerKeyRight,
      },
    })),
  };
}

function download(name: string, data: string | Uint8Array, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportPanel({ cards, profiles, db, copies }: { cards: Card[]; profiles: TableProfile[]; db: () => Promise<Db>; copies: Map<string, string> }) {
  const [tab, setTab] = useState<'sql' | 'python' | 'yaml'>('python');
  const [error, setError] = useState('');
  const mapping = buildMapping(cards, profiles);
  const approved = mapping.joins.filter((j) => j.status === 'approved');
  const code = { sql: emitSqlScript(mapping), python: emitPython(mapping), yaml: toYaml(mapping) };
  const names = { sql: 'join.sql', python: 'join_pandas.py', yaml: 'mapping.yml' };

  const joinedCsv = async (id: string) => {
    setError('');
    try {
      const j = mapping.joins.find((x) => x.id === id)!;
      const p = joinParts(planOf(j), profiles);
      const d = (await db()) as WasmDb;
      const bytes = await d.exportFile(`${id}.csv`, `COPY (${withCtes(p.ctes, p.select)}) TO '__OUT__' (FORMAT csv, HEADER)`);
      download(`${id}.csv`, bytes, 'text/csv');
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : String(e));
    }
  };

  return (
    <section className="export" aria-labelledby="export-h">
      <h2 id="export-h">Take it with you</h2>
      {approved.length === 0 ? (
        <p className="hint">Approve a join and it shows up here as data, SQL, Python and a decision file you can keep.</p>
      ) : (
        <>
          <p className="hint">Covers the {approved.length === 1 ? 'join' : `${approved.length} joins`} you approved. Rejected joins are kept in mapping.yml as rejected, so the decision is on record.</p>
          <div className="downloads">
            {approved.map((j) => <button key={j.id} onClick={() => void joinedCsv(j.id)}>Download the joined data: {j.id}.csv</button>)}
            <button onClick={() => download('join.sql', code.sql, 'text/plain')}>Download join.sql</button>
            <button onClick={() => download('join_pandas.py', code.python, 'text/x-python')}>Download join_pandas.py</button>
            <button onClick={() => download('mapping.yml', code.yaml, 'text/yaml')}>Download mapping.yml</button>
            {profiles.filter((p) => p.readFrom && copies.has(p.readFrom)).map((p) => (
              <button key={p.table} onClick={() => download(p.readFrom!, copies.get(p.readFrom!)!, 'text/csv')}>Download {p.readFrom}</button>
            ))}
          </div>
          {profiles.some((p) => p.readFrom) && <p className="hint small">The scripts read your Excel files through these CSV copies, so they get exactly the rows the receipts counted. Save them next to the scripts.</p>}
          {error && <p className="warn" role="alert">{error}</p>}
          <p className="hint small">Or read it here first. mapping.yml is the decision file: every key, cleanup and approval, so the same join runs the same way next time.</p>
          <div className="code-bar">
          <div className="tabs" role="tablist" aria-label="Generated code">
            {(['python', 'sql', 'yaml'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>{names[t]}</button>
            ))}
          </div>
          <button className="copy quiet" onClick={() => void navigator.clipboard.writeText(code[tab])}>Copy</button>
          </div>
          <div className="code" role="tabpanel">
            <pre tabIndex={0}>{code[tab]}</pre>
          </div>
        </>
      )}
    </section>
  );
}
