# Join Receipt v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser tool that loads 2–10 data files, profiles them, ranks candidate joins, and writes a receipt per join (matches, drops and why, fan-out), with optional AI-drafted fixes from a closed grammar, and exports joined data, SQL, Python and `mapping.yml`.

**Architecture:** An engine-agnostic TypeScript core builds SQL from typed plans and runs it through a `Db` interface; DuckDB-Wasm backs it in the browser and `@duckdb/node-api` in tests and fixtures. Every number on screen comes from a SQL query whose expressions are the ones the user downloads. A React app on top holds state in one reducer.

**Tech Stack:** Node 22+, npm workspaces, TypeScript 5 (strict), Vitest, `@duckdb/node-api`, `@duckdb/duckdb-wasm`, Vite, React 19.

**Spec:** `docs/specs/2026-11-09-join-receipt-v1-design.md` (read it first).

## Global Constraints

- No backend, no accounts. With no AI connected, the app makes no network request carrying user data.
- `packages/core` imports nothing from DuckDB, React or the DOM. It runs in Node and the browser.
- Every identifier in emitted SQL is double-quoted with `"` doubled inside; every string literal single-quoted with `'` doubled. No string concatenation of user values anywhere else.
- AI output is JSON parsed into the grammar types by `validateOps`; nothing else from a model is executed or shown as a number.
- Score label is exactly "heuristic, not a probability".
- Lift threshold 3, minimum unmatched count 3, columns with 3–50 distinct values only.
- Fan-out warning when `joined_rows / left_rows > 1.05`.
- `mapping.yml` + tool version → byte-identical SQL and Python.
- Dev server port 3066.
- Copy on screen is placeholder-plain; final strings go through joel-voice at the controller.

## File map

```
package.json                         workspaces, scripts: test, typecheck, accuracy, dev
tsconfig.base.json
packages/core/src/
  db.ts                              Db interface
  grammar.ts                         Transform/Aggregate/JoinOn/KeyRef types + validateOps
  sql/quote.ts                       ident(), lit()
  sql/crosswalks.ts                  US state + country crosswalk rows (with source citation)
  sql/emit.ts                        keyExpr(), crosswalkCtes(), joinSelect()
  load.ts                            loadFile(db, name, bytes) → LoadedTable
  formats.ts                         classifyColumn(name, samples, stats) → FormatClass
  profile.ts                         profileTable(db, table) → TableProfile (incl. grain)
  candidates.ts                      findCandidates(db, profiles) → CandidateResult
  score.ts                           scoreCandidate(features) → { score, reason }
  receipt.ts                         buildReceipt(db, profiles, plan) → Receipt
  mapping.ts                         toYaml(mapping) / fromYaml(text)
  emit-python.ts                     emitPython(mapping, flavour)
  emit-sql.ts                        emitSqlScript(mapping)
  ai/payload.ts                      buildPayload(...), maskValue()
  ai/prompt.ts                       PROMPT, promptHash()
  ai/providers.ts                    callModel(config, payload) → unknown
  ai/drafts.ts                       draftFixes(db, profiles, candidate, config) → Draft[]
  index.ts                           re-exports
packages/core/test/*.test.ts
packages/core-node/src/index.ts      NodeDb implements Db
packages/join-receipt/               Vite app (src/main.tsx, App.tsx, state.ts, wasmDb.ts, components/*)
fixtures/join-receipt/generate.ts    writes pairs/<id>/{left,right}.csv + label.json
fixtures/join-receipt/accuracy.ts    prints top-1, none-precision, failures; writes accuracy.json
docs/adr/0001..0004
README.md, LICENSE (MIT), .github/workflows/ci.yml
```

---

### Task 1: Monorepo scaffold and the Db adapter

**Files:** Create root `package.json`, `tsconfig.base.json`, `packages/core/{package.json,tsconfig.json,src/db.ts,src/index.ts}`, `packages/core-node/{package.json,src/index.ts}`, `packages/core/test/db.test.ts`, `vitest.config.ts`.

**Interfaces — Produces:**
```ts
export type Row = Record<string, unknown>;
export interface Db {
  query(sql: string): Promise<Row[]>;            // BigInt converted to number when |n| < 2^53, else string
  registerFile(name: string, bytes: Uint8Array): Promise<void>; // makes `name` readable by read_csv_auto etc.
  resolve(name: string): string;                 // path to use inside SQL for a registered file (Wasm: name; Node: temp path)
}
// core-node
export async function createNodeDb(): Promise<Db>; // in-memory DuckDB; registerFile writes to a temp dir and maps name→path
```

- [ ] Test: `createNodeDb()` → `query("select 1 as x")` returns `[{x:1}]`; `registerFile('a.csv', 'id\n1\n2')` then `query("select count(*) n from read_csv_auto('a.csv')")` returns `[{n:2}]`.
- [ ] Run, see fail, implement, see pass. `registerFile` in Node writes bytes to `os.tmpdir()/jr-<pid>/<name>` and records name→path; `resolve(name)` returns it. `load.ts` always reads through `db.resolve(name)`.
- [ ] Commit `chore: scaffold monorepo, Db interface, node adapter`.

### Task 2: Grammar types and validator

**Files:** `packages/core/src/grammar.ts`, `test/grammar.test.ts`.

**Produces:**
```ts
export type CodeKind = 'name' | 'abbr' | 'fips' | 'iso2' | 'iso3';
export type Transform =
  | { op: 'trim' } | { op: 'lower' } | { op: 'upper' }
  | { op: 'lpad'; width: number; fill: string }
  | { op: 'crosswalk'; table: 'us_state' | 'country'; from: CodeKind; to: CodeKind }
  | { op: 'cast'; to: 'varchar' | 'integer' | 'date' }
  | { op: 'date_trunc'; unit: 'day' | 'month' | 'year' };
export interface KeyRef { table: string; column: string; transforms: Transform[] }
export interface JoinOn { op: 'join_on'; left: KeyRef; right: KeyRef; how: 'inner' | 'left' }
export type AggFn = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first';
export interface Aggregate { op: 'aggregate'; table: string; by: string[]; measures: { column: string; fn: AggFn }[] }
export interface Schema { [table: string]: string[] }
export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };
export function validateTransform(x: unknown): Validated<Transform>;
export function validateJoinOn(x: unknown, schema: Schema): Validated<JoinOn>;
export function validateAggregate(x: unknown, schema: Schema): Validated<Aggregate>;
```
Rules: unknown `op` rejected; extra keys rejected; `lpad.width` integer 1–20, `fill` exactly one char from `[0-9A-Za-z _-]`; crosswalk kinds valid for the table (us_state: name/abbr/fips; country: name/iso2/iso3) and `from !== to`; table/column must exist in schema; at most 6 transforms per key.

- [ ] Tests: accepts each valid op; rejects `{op:'sql', text:'drop table'}`, `lpad` width 0/21/1.5, fill `''`/`"'"`, unknown column, extra key `{op:'trim', x:1}`, crosswalk country→fips, 7 transforms.
- [ ] Implement, pass, commit `feat(core): closed grammar and validator`.

### Task 3: SQL quoting, crosswalks and the key-expression emitter

**Files:** `sql/quote.ts`, `sql/crosswalks.ts`, `sql/emit.ts`, tests.

**Produces:**
```ts
export const ident: (s: string) => string;      // "a""b"
export const lit: (s: string | number) => string; // 'it''s' ; numbers as-is if finite
export interface CrosswalkRow { name: string; abbr?: string; fips?: string; iso2?: string; iso3?: string }
export const US_STATES: CrosswalkRow[];  // 50 states + DC + PR, FIPS 2-digit strings; source: US Census Bureau FIPS state codes
export const COUNTRIES: CrosswalkRow[];  // ISO 3166-1 subset (~60 common countries), source cited
export function keyExpr(ref: KeyRef, alias: string): string;   // SQL expression over alias.column
export function crosswalkCtes(refs: KeyRef[]): string[];       // `cw_us_state(name, abbr, fips) AS (VALUES ...)`, deduped, sorted
```
Transform SQL: trim→`trim(x)`, lower→`lower(x)`, upper→`upper(x)`, lpad→`lpad(CAST(x AS VARCHAR), w, 'f')`, cast varchar→`CAST(x AS VARCHAR)`, integer→`TRY_CAST(x AS BIGINT)`, date→`TRY_CAST(x AS DATE)`, date_trunc→`date_trunc('unit', TRY_CAST(x AS TIMESTAMP))`, crosswalk→ scalar subquery `(SELECT cw.to FROM cw_<t> cw WHERE upper(cw.from) = upper(CAST(x AS VARCHAR)))` (upper on both sides so `alabama` hits). Transforms apply left to right.

- [ ] Tests: `ident('a"b')` = `"a""b"`; `lit("it's")` = `'it''s'`; keyExpr with `[cast varchar, lpad 5 '0']` runs in DuckDB on `1001` → `01001`; crosswalk name→abbr maps `alabama` → `AL` executing the CTE + expression in NodeDb; US_STATES has 52 rows with unique fips.
- [ ] Implement, pass, commit `feat(core): sql emitter and crosswalks`.

### Task 4: Loading, format classification, profiling, grain

**Files:** `load.ts`, `formats.ts`, `profile.ts`, tests with small inline CSVs.

**Produces:**
```ts
export interface LoadedTable { name: string; file: string; rows: number; error?: undefined }
export interface LoadError { file: string; error: string }
export function tableNameFor(file: string, taken: Set<string>): string; // lower snake, dedup with _2
export async function loadFile(db: Db, file: string, bytes: Uint8Array, taken: Set<string>): Promise<LoadedTable | LoadError>;
// CREATE TABLE <ident> AS SELECT * FROM read_csv_auto(<lit path>, sample_size=-1) / read_parquet / read_json_auto by extension (.csv .tsv .txt .parquet .json .ndjson .jsonl)
export type FormatClass = 'us_state_fips'|'county_fips'|'us_state_abbr'|'us_state_name'|'iso2'|'iso3'|'country_name'|'zip5'|'email'|'date'|'timestamp'|'year'|'currency'|'integer_id'|'numeric'|'free_text'|'categorical'|'boolean'|'unknown';
export function classifyColumn(input: { name: string; type: string; samples: string[]; distinct: number; rows: number }): FormatClass;
export function formatFamily(f: FormatClass): 'us_state'|'county'|'country'|'zip'|'email'|'temporal'|'id'|'text'|'other';
export interface ColumnProfile { name: string; type: string; distinct: number; nulls: number; nullPct: number; unique: boolean; format: FormatClass; samples: string[]; minLen: number; maxLen: number }
export interface TableProfile { table: string; file: string; rows: number; sampled: boolean; columns: ColumnProfile[]; grain: string[] | null }
export async function profileTable(db: Db, table: string, file: string): Promise<TableProfile>;
```
Classifier: ≥ 90% of samples match the class rule. Name hints break ties (`fips`, `state`, `country`, `zip`, `email`, `date`, `year`). county_fips: 4–5 digit ints/strings, values ≤ 56999; state fips: 1–2 digits ≤ 78; state abbr: 2 letters in the US set; state name: case-insensitive in US names; iso2/iso3/country name via COUNTRIES; year: integer 1800–2100 with name hint or distinct ≤ 300; boolean: ≤ 2 distinct; categorical: text with distinct ≤ 50 and ≤ 20% of rows.
Grain: first unique non-null column (prefer `*_id`/format id names); else first unique pair among columns with ≤ 1% nulls and not `numeric`/`currency`; else null.

- [ ] Tests: loads csv/parquet(written by DuckDB COPY)/ndjson; a bad file returns `LoadError` naming it; classifier fixtures (`['01001','01003']`→county_fips, `[1001,1003]` with name `fips`→county_fips, `['AL','AK']`→us_state_abbr, `['Alabama']`→us_state_name, `['a@b.co']`→email, `['2024-01-01']`→date); profile of `id,state,value` gives distinct/nulls matching hand counts and grain `['id']`; daily table `date,county,value` → grain `['date','county']`.
- [ ] Implement, pass, commit `feat(core): load and profile`.

### Task 5: Candidate joins and the score

**Files:** `candidates.ts`, `score.ts`, tests.

**Produces:**
```ts
export interface Features { containLeft: number; containRight: number; leftUnique: boolean; rightUnique: boolean; formatMatch: boolean; nameSim: number; minDistinct: number; transformsCount: number }
export function nameSimilarity(a: string, b: string): number; // token Jaccard on snake/camel split, plus 1.0 for equal after stripping common suffixes
export function scoreCandidate(f: Features, left: KeyRef, right: KeyRef): { score: number; reason: string };
// score = round(100 * (0.55*max(containLeft,containRight) + 0.15*(leftUnique||rightUnique) + 0.15*formatMatch + 0.15*nameSim)) - (minDistinct < 3 ? 60 : 0) - 2*transformsCount, clamped 0..100
export interface JoinCandidate { left: KeyRef; right: KeyRef; features: Features; score: number; reason: string }
export interface CandidateResult { pairs: { left: string; right: string; best: JoinCandidate[]; reliable: boolean }[] }
export function normalisationChains(l: ColumnProfile, r: ColumnProfile): { left: Transform[]; right: Transform[] }[];
export async function findCandidates(db: Db, profiles: TableProfile[]): Promise<CandidateResult>;
```
Chains always include `[]/[]`; text pairs add `[trim,lower]/[trim,lower]`; integer-ish vs zero-padded → `[cast varchar, lpad w '0']` on the unpadded side where w = max length on the padded side; state name/abbr/fips combos → crosswalk on one side to the other's kind; dates vs timestamps → `date_trunc day` both; year vs date → `date_trunc year` + cast is out (v1 notes it as a grain mismatch instead). Prune column pairs: same format family, or nameSim ≥ 0.5 and compatible types; skip pairs with minDistinct < 3 unless nameSim = 1; skip `free_text`, `numeric`, `currency`. Containment query on distinct transformed values: `WITH l AS (SELECT DISTINCT <expr> k FROM t1 WHERE k IS NOT NULL), r AS (...) SELECT (SELECT count(*) FROM l), (SELECT count(*) FROM r), (SELECT count(*) FROM l JOIN r USING (k))`. Keep the best chain per column pair; `reliable` when the top score ≥ 50 and its max containment ≥ 0.6; otherwise the top 3 are near-misses.

- [ ] Tests: counties (`fips` int) × unemployment (`county_fips` '01001') → top candidate is that pair with lpad chain, score ≥ 80, reason mentions "zero-padding"; states-by-name × states-by-abbr → crosswalk; two tables with only `id` ints overlapping 10% plus a real email key → email ranked first; tables with no shared key → `reliable: false`, ≤ 3 near-misses.
- [ ] Implement, pass, commit `feat(core): candidate joins and heuristic score`.

### Task 6: The receipt

**Files:** `receipt.ts`, tests.

**Produces:**
```ts
export interface Plan { join: JoinOn; aggregateRight?: Aggregate | null; aggregateLeft?: Aggregate | null }
export interface Pattern { column: string; value: string; unmatchedCount: number; unmatchedShare: number; overallShare: number; lift: number }
export interface TransformSample { side: 'left'|'right'; raw: string; transformed: string | null }
export interface Receipt {
  leftRows: number; rightRows: number; joinedRows: number;
  matchedLeft: number; unmatchedLeft: number; unmatchedRight: number;
  matchRateBefore: number | null; matchRateAfter: number;     // before = with no transforms
  fanout: number; maxPerKeyLeft: number; maxPerKeyRight: number;
  patternsLeft: Pattern[]; patternsRight: Pattern[];
  samples: TransformSample[];
  proposedAggregate: Aggregate | null;
  sql: string;                                                 // the select that produced joinedRows
}
export async function buildReceipt(db: Db, profiles: TableProfile[], plan: Plan): Promise<Receipt>;
export function proposeAggregate(profile: TableProfile, keyColumn: string): Aggregate; // sum numeric non-key, first otherwise
export function describePattern(p: Pattern, side: string, unmatchedTotal: number): string; // "all 34 unmatched rows have state = AK (AK is 1% of the file)" / "29 of 34 ..."
```
Lift query per eligible column (3–50 distinct, from profile): `SELECT col v, count(*) FILTER (WHERE unmatched) u, count(*) n FROM tagged GROUP BY 1`, where `tagged` marks each row unmatched via `NOT EXISTS` against the other side's key set. Keep values with u ≥ 3 and lift ≥ 3; top 2 across columns by lift then count. When aggregates are present the right (or left) side is first rolled up in a CTE and receipts use the rolled-up side.

- [ ] Tests (NodeDb, inline data): 10 left rows, 7 match, 3 unmatched all `state='AK'` (AK 3 of 10) → pattern lift 3.33 and describePattern says "all 3"; a column with 2 distinct values is never reported; daily (3 rows per key) × yearly → fanout 3.0 and proposedAggregate sums `value`, firsts `name`; with that aggregate applied fanout 1.0; matchRateBefore 0 and after 1.0 for unpadded codes; samples show `1001 → 01001`.
- [ ] Implement, pass, commit `feat(core): receipts with lift and fan-out`.

### Task 7: mapping.yml, SQL script and Python emitters

**Files:** `mapping.ts`, `emit-sql.ts`, `emit-python.ts`, tests.

**Produces:**
```ts
export const TOOL_VERSION = '0.1.0';
export interface MappingJoin { id: string; plan: Plan; status: 'approved'|'rejected'|'proposed'; proposedBy: 'rule'|'llm'|'user'; llm: { model: string; promptSha256: string } | null; receipt: { matched: number; unmatchedLeft: number; unmatchedRight: number; fanout: number } }
export interface Mapping { version: string; tables: { name: string; file: string; grain: string[] | null }[]; joins: MappingJoin[] }
export function toYaml(m: Mapping): string;      // own serializer: 2-space indent, keys in fixed order, strings quoted when needed, numbers via toFixed-free canonical form
export function fromYaml(s: string): Mapping;    // parses only what toYaml writes (use `yaml` npm package for parsing; serializer stays ours)
export function emitSqlScript(m: Mapping): string; // header comment with version, sources as CTEs `t AS (SELECT * FROM read_csv_auto('file'))`, crosswalk CTEs, aggregates, then final SELECT chaining approved joins left-to-right from the first table
export function emitPython(m: Mapping, flavour: 'pandas'|'duckdb'): string;
```
Python pandas: `pd.read_csv(file, dtype=str)` for keys, transforms via `.str.strip()`, `.str.lower()`, `.str.zfill(w)` when fill is `0` else `.str.rjust(w, fill)`, crosswalk dict literal + `.str.upper().map()`, `pd.to_datetime(...).dt.floor('D')/.dt.to_period('Y')`; aggregates via `groupby(by, as_index=False).agg(**{col: (col, fn)})` with `first`; merge with `how=`, `indicator=True`, `validate='m:1'` when right unique; `assert len(df) == <joinedRows>`. Python duckdb flavour: `duckdb.sql("""<emitSqlScript>""").df()`.

- [ ] Tests: `fromYaml(toYaml(m))` deep-equals m; `toYaml` twice → identical bytes; `emitSqlScript` twice identical; the SQL script executed in NodeDb (files registered) returns the receipt's joinedRows for a fixture; emitPython contains `zfill(5)` and the assert line. If `python3` with pandas is available, run the snippet in a test that is skipped otherwise.
- [ ] Implement, pass, commit `feat(core): mapping.yml and code emitters`.

### Task 8: AI drafts behind the closed grammar

**Files:** `ai/payload.ts`, `ai/prompt.ts`, `ai/providers.ts`, `ai/drafts.ts`, tests with a fake provider.

**Produces:**
```ts
export function maskValue(v: string): string;   // digits→9, lowercase→a, uppercase→A, others kept; public codes (US_STATES/COUNTRIES values) kept as-is
export interface Payload { task: string; left: ColumnSummary; right: ColumnSummary; currentReceipt: { matchRate: number; unmatchedExamples: string[] }; allowedOps: string[] }
export function buildPayload(profiles: TableProfile[], c: JoinCandidate, receipt: Receipt, unmatchedExamples: string[], mode: 'masked'|'raw'): Payload;
export const PROMPT: string; export function promptHash(): Promise<string>; // SHA-256 hex via crypto.subtle
export interface ModelConfig { kind: 'anthropic'|'openai-compatible'; endpoint: string; model: string; apiKey: string }
export type Fetcher = typeof fetch;
export async function callModel(cfg: ModelConfig, payload: Payload, f?: Fetcher): Promise<unknown>; // returns parsed JSON {proposals:[{left:Transform[], right:Transform[], why:string}]}
export interface Draft { left: Transform[]; right: Transform[]; why: string; ok: true; receipt: Receipt; delta: number } | { ok: false; raw: unknown; error: string }
export async function draftFixes(db: Db, profiles: TableProfile[], c: JoinCandidate, cfg: ModelConfig, f?: Fetcher): Promise<Draft[]>;
```
Anthropic: POST `{endpoint}/v1/messages` headers `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`; OpenAI-compatible: POST `{endpoint}/chat/completions` with `Authorization: Bearer` when a key is set, `response_format: {type:'json_object'}`. Extract the first JSON object from the text. Max 5 proposals; each validated via `validateTransform`; valid ones get a receipt; sorted by match-rate delta.

- [ ] Tests: maskValue('Ann-01') = 'Aaa-99'; maskValue('AK') = 'AK'; masked payload contains no raw sample values from a fixture; a fake fetch returning one valid + one `{op:'sql'}` proposal yields one ok draft with positive delta and one rejected with error naming `sql`; the request body for raw mode contains the raw samples, masked does not.
- [ ] Implement, pass, commit `feat(core): AI drafts through the closed grammar`.

### Task 9: Fixture set and accuracy runner

**Files:** `fixtures/join-receipt/generate.ts`, `accuracy.ts`, `pairs/` (generated, committed), `accuracy.json`.

Seeded PRNG (mulberry32, seed 20261109). Base tables: states (52), counties (~300 synthetic county FIPS = state fips + 3 digits), countries (~60), customers/orders (email key + decoy int ids), daily/yearly sales. Pair families (≥ 36 total): clean (6), unpadded FIPS (5), case/whitespace drift (5), name vs code (6), decoy id columns (4), grain mismatch (4), partial drop with a planted pattern (4), no key (4+). `label.json`: `{ "left": {"table","column"}, "right": {...} }` or `{ "none": true }`. Accuracy: top-1 correct when the top candidate's columns match the label (either orientation); none-precision = correct "no reliable join" among `none` labels.

- [ ] Run `npm run accuracy`; target ≥ 90% top-1. Below target → fix the scorer/classifier, not the labels. Commit `feat(fixtures): labelled join set and accuracy runner`.

### Task 10: Web app

**Files:** `packages/join-receipt/{package.json,vite.config.ts,index.html,src/main.tsx,src/App.tsx,src/state.ts,src/wasmDb.ts,src/samples.ts,src/components/{DropZone,FileCard,ReceiptCard,TransformEditor,AggregateEditor,AiPanel,ExportPanel}.tsx,src/styles.css}`.

- `wasmDb.ts`: `createWasmDb()` using `@duckdb/duckdb-wasm` bundles via Vite `?url` imports (mvp + eh), `registerFileBuffer`, converts Arrow rows to plain objects with BigInt handling identical to NodeDb.
- `samples.ts`: generates three sample files in the browser from the same generator code as fixtures (counties with int FIPS, unemployment with zero-padded FIPS missing AK rows, daily sales by county).
- `state.ts`: reducer with `files`, `profiles`, `candidates`, `cards: Record<id, {plan, receipt, status, drafts, busy, error}>`, `ai: ModelConfig & {mode}`; actions LOAD_START/LOADED/PROFILED/CANDIDATES/CARD_EDIT/RECEIPT/APPROVE/REJECT/DRAFTS.
- ReceiptCard: `<article aria-labelledby>`, numbers in a `<dl>`, Approve/Reject buttons (keyboard reachable), pattern sentence, fan-out warning with AggregateEditor, transform chips with remove/add, before/after table.
- ExportPanel: builds Mapping from approved cards; downloads via Blob URLs; joined CSV/Parquet via `COPY (<emitSqlScript select>) TO 'out.csv'` in Wasm then `copyFileToBuffer`.
- Vite dev server port 3066, `strictPort: true`; `optimizeDeps.exclude: ['@duckdb/duckdb-wasm']`.

- [ ] Typecheck, boot via `preview_start` (`join-receipt` entry in the session's `.claude/launch.json`), load sample data, approve a join, download each file, check console clean, screenshots at 390 and 1280. Commit `feat(web): join receipt app`.

### Task 11: Repo P0

- [ ] README: one paragraph, what it does, quick start (`npm install`, `npm run dev`, `npm test`, `npm run accuracy`), the accuracy number from `accuracy.json`, limits (Excel, synthetic samples, single-pair joins), privacy statement. ADRs 0001 closed grammar, 0002 mapping.yml as source of truth, 0003 single Node runtime, 0004 no backend. `.github/workflows/ci.yml`: install, typecheck, test, accuracy. MIT LICENSE.
- [ ] Final: `npm run typecheck && npm test && npm run accuracy` all green. Commit `docs: README, ADRs, CI`.
