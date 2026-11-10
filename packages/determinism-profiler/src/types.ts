import type { Fingerprint } from './fingerprint.js';

export type InputKind = 'notebook' | 'sql' | 'dbt';
export type StepKind = 'cell' | 'sql' | 'dbt_model' | 'dbt_seed' | 'dbt_snapshot' | 'source';

export type Cause = 'timestamp' | 'random' | 'unseeded_sample' | 'unordered_limit' | 'ties' | 'set_order' | 'float_order' | 'ai_step';

export interface Finding {
  file: string;
  line: number;
  /** Notebook code-cell number (1-based) when the finding is in a notebook. */
  cell?: number;
  cause: Cause;
  keyword: string;
  kind: 'definite' | 'candidate' | 'judgment' | 'runtime';
  step: string;
  /** Filled in after the runs: confirmed | latent | candidate | upstream. */
  status: 'pending' | 'confirmed' | 'latent' | 'candidate' | 'upstream';
}

export interface Location {
  file: string;
  line?: number;
  cell?: number;
}

/** One step as recorded in one run. Digests and names only (ADR 0005). */
export interface TraceStep {
  step_id: string;
  kind: StepKind;
  label: string;
  location: Location;
  parents: string[];
  source_hash?: string;
  /** input id → identity digest of that input in this run */
  input_hashes: Record<string, string>;
  /** output name → fingerprint */
  outputs: Record<string, Fingerprint>;
  params?: Record<string, string | number | boolean>;
  duration_ms: number;
  status: 'ok' | 'error' | 'not_run';
  error?: string;
  judgment?: boolean;
}

export interface Trace {
  schema: 'determinism-profiler/trace@1';
  tool_version: string;
  input: { kind: InputKind; name: string };
  run: number;
  started_at: string;
  params: Record<string, string | number | boolean>;
  steps: TraceStep[];
  notes: string[];
}

export type Verdict = 'same' | 'order' | 'float' | 'values' | 'rows' | 'skipped' | 'error';
export type Attribution = 'origin' | 'inherited' | 'inconclusive' | 'none';

export interface StepResult {
  step_id: string;
  kind: StepKind;
  label: string;
  location: Location;
  verdict: Verdict;
  attribution: Attribution;
  judgment: boolean;
  /** Which outputs moved (variable or "display"), and which columns inside them. */
  moved: { output: string; verdict: Verdict; columns: string[] }[];
  /** For inherited/inconclusive: the origin steps or sources it traces back to. */
  from: string[];
  /** Inputs that differed between runs. */
  changed_inputs: string[];
  rows: number[];
  findings: Finding[];
  duration_ms: number[];
}

export interface Report {
  schema: 'determinism-profiler/report@1';
  tool_version: string;
  input: { kind: InputKind; name: string };
  runs: number;
  generated_at: string;
  score: { same: number; scored: number; percent: number };
  steps: StepResult[];
  sources: StepResult[];
  findings: Finding[];
  notes: string[];
  static_only: boolean;
}
