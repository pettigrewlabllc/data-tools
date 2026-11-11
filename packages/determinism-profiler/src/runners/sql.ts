import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { Fingerprinter, bytesFingerprint, identity, sourceHash, type Fingerprint } from '../fingerprint.js';
import { fingerprintInDuckDB, fingerprintQueryInDuckDB } from '../fingerprint-sql.js';
import { checkStatement, referencesOf, shapeOf, splitStatements, type Statement, type StatementShape } from '../static/sql.js';
import type { Finding, TraceStep } from '../types.js';

export interface SqlStepPlan {
  id: string;
  file: string; // relative to the SQL root
  line: number;
  statement: Statement;
  shape: StatementShape;
  label: string;
  parents: string[]; // step ids, including source:<file>
  files: string[]; // source files this statement reads (relative to root)
  isStep: boolean;
}

export interface SqlPlan {
  root: string;
  steps: SqlStepPlan[]; // every statement, in run order (isStep marks the profiled ones)
  sources: string[]; // relative file paths
  findings: Finding[];
}

function listSql(root: string): string[] {
  if (statSync(root).isFile()) return [root];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.sql')) out.push(p);
    }
  };
  walk(root);
  return out.sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
}

/** Reads the folder, splits statements, links parents and runs the static checks. No execution. */
export function planSql(path: string): SqlPlan {
  const abs = resolve(path);
  const root = statSync(abs).isFile() ? dirname(abs) : abs;
  const files = listSql(abs);
  if (!files.length) throw new Error(`No .sql files found in ${path}`);
  const steps: SqlStepPlan[] = [];
  const producer = new Map<string, string>(); // table name → step id that last wrote it
  const sources = new Set<string>();
  const findings: Finding[] = [];
  const state = { seeded: false };
  for (const f of files) {
    const rel = relative(root, f);
    const statements = splitStatements(readFileSync(f, 'utf8'));
    statements.forEach((st, i) => {
      const shape = shapeOf(st);
      const isStep = shape.kind !== 'other';
      const id = `${rel}:${st.line}`;
      const refs = referencesOf(st);
      const parents = new Set<string>();
      for (const t of refs.tables) {
        const p = producer.get(t.toLowerCase());
        if (p && t.toLowerCase() !== shape.target?.toLowerCase()) parents.add(p);
        else if (p && shape.kind === 'mutation') parents.add(p);
      }
      if (shape.kind === 'mutation' && shape.target) {
        const p = producer.get(shape.target.toLowerCase());
        if (p) parents.add(p);
      }
      const srcFiles = refs.files.filter((x) => x !== shape.copyTo).map((x) => relative(root, resolve(root, x)));
      for (const sf of srcFiles) {
        sources.add(sf);
        parents.add(`source:${sf}`);
      }
      const label =
        shape.kind === 'relation' ? `${shape.view ? 'view' : 'table'} ${shape.target}` :
        shape.kind === 'mutation' ? `${st.tokens[0].text} ${shape.target}` :
        shape.kind === 'copy' ? `copy to ${shape.copyTo}` :
        shape.kind === 'result' ? `query` : st.tokens[0]?.text ?? 'statement';
      steps.push({ id, file: rel, line: st.line, statement: st, shape, label, parents: [...parents], files: srcFiles, isStep });
      // Only statements that produce something are checked. Schema DDL (a column's DEFAULT now()),
      // functions, SET and friends aren't analysis steps; flagging them buried real findings in a pg_dump.
      const f = checkStatement(st, rel, id, state);
      if (isStep) findings.push(...f);
      if ((shape.kind === 'relation' || shape.kind === 'mutation') && shape.target) producer.set(shape.target.toLowerCase(), id);
      void i;
    });
  }
  return { root, steps, sources: [...sources], findings };
}

/** Keep only the named steps (by file name, table name, or step id) and their transitive parents. */
export function selectSql(plan: SqlPlan, select: string[]): Set<string> {
  const want = new Set<string>();
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  for (const s of plan.steps) {
    if (!s.isStep) continue;
    if (select.some((x) => x === s.id || x === s.file || x === s.file.replace(/\.sql$/, '') || x.toLowerCase() === s.shape.target?.toLowerCase())) want.add(s.id);
  }
  const stack = [...want];
  while (stack.length) {
    const id = stack.pop()!;
    for (const p of byId.get(id)?.parents ?? []) if (!want.has(p) && byId.has(p)) { want.add(p); stack.push(p); }
  }
  return want;
}

async function fingerprintQuery(conn: DuckDBConnection, sql: string, orderMatters: boolean): Promise<Fingerprint> {
  const result = await conn.stream(sql);
  const names = result.columnNames();
  const fp = new Fingerprinter(names, orderMatters);
  for await (const rows of result.yieldRowsJson()) for (const row of rows) fp.addRow(row as unknown[]);
  return fp.finish();
}

const q = (name: string) => '"' + name.replaceAll('"', '""') + '"';

/** One run: fresh in-memory DuckDB, every statement in order, steps fingerprinted. */
export async function runSqlOnce(plan: SqlPlan, include: Set<string> | null): Promise<TraceStep[]> {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  const cwd = process.cwd();
  process.chdir(plan.root);
  const out: TraceStep[] = [];
  const latest = new Map<string, Record<string, Fingerprint>>();
  try {
    for (const src of plan.sources) {
      const p = join(plan.root, src);
      const fp = existsSync(p) ? bytesFingerprint(readFileSync(p)) : { ...bytesFingerprint(new Uint8Array()), skipped: 'file not found' };
      latest.set(`source:${src}`, { file: fp });
      out.push({ step_id: `source:${src}`, kind: 'source', label: src, location: { file: src }, parents: [], input_hashes: {}, outputs: { file: fp }, duration_ms: 0, status: 'ok' });
    }
    for (const s of plan.steps) {
      if (include && !include.has(s.id) && s.isStep) continue;
      const input_hashes: Record<string, string> = {};
      for (const p of s.parents) {
        const outs = latest.get(p);
        if (outs) for (const [name, fp] of Object.entries(outs)) input_hashes[`${p}#${name}`] = identity(fp);
      }
      const t0 = performance.now();
      const step: TraceStep = {
        step_id: s.id, kind: s.isStep ? 'sql' : 'sql', label: s.label, location: { file: s.file, line: s.line },
        parents: s.parents, source_hash: sourceHash(s.statement.text), input_hashes, outputs: {}, duration_ms: 0, status: 'ok',
      };
      try {
        if (s.shape.kind === 'result') {
          // DuckDB-side hashing; statements that can't sit inside CREATE TABLE AS (DESCRIBE, SUMMARIZE) stream instead.
          try { step.outputs.result = await fingerprintQueryInDuckDB(conn, s.statement.text); }
          catch { step.outputs.result = await fingerprintQuery(conn, s.statement.text, true); }
        } else {
          await conn.run(s.statement.text);
          if ((s.shape.kind === 'relation' || s.shape.kind === 'mutation') && s.shape.target) {
            step.outputs[s.shape.target] = await fingerprintInDuckDB(conn, q(s.shape.target), false);
          } else if (s.shape.kind === 'copy' && s.shape.copyTo) {
            const p = resolve(plan.root, s.shape.copyTo);
            step.outputs[s.shape.copyTo] = existsSync(p) ? bytesFingerprint(readFileSync(p)) : { ...bytesFingerprint(new Uint8Array()), skipped: 'no file written' };
          }
        }
      } catch (e) {
        step.status = 'error';
        step.error = errorKind(e); if (process.env.DP_DEBUG) console.error(e);
        if (!s.isStep) throw new Error(`${s.file}:${s.line}: ${step.error}`);
      }
      step.duration_ms = Math.round(performance.now() - t0);
      if (s.isStep) {
        latest.set(s.id, step.outputs);
        out.push(step);
      }
    }
  } finally {
    process.chdir(cwd);
    conn.closeSync();
    instance.closeSync();
  }
  return out;
}

/** Error messages can quote data ("could not convert 'x'"), so traces keep only the error's kind. */
export function errorKind(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return m.split(/[:\n]/)[0].slice(0, 60);
}
