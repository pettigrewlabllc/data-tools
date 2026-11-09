# Join Receipt v1: build design

**Date:** 2026-11-09 · **Status:** draft for Fable review, then build · **PRD:** `2026-11-09-join-receipt-prd.md` (same folder)

Joel handed this off to run unattended: brainstorm the build, have Fable review the plan, build locally. Every decision below that the PRD left open is mine, and is listed under "Decisions I made" so he can overrule any of them.

## 1. What this session builds

The PRD sizes v1 at 5–6 weeks. One unattended session can't do all of it, so this design covers the **whole v1 architecture**, and the build tonight lands a **working vertical slice** of it: the shape that every later requirement plugs into, with nothing faked.

| PRD id | Tonight | Notes |
|---|---|---|
| A1 load | CSV, TSV, Parquet, JSON/NDJSON | Excel deferred (see decisions) |
| A2 profile | Yes | Type, distinct, null %, uniqueness, format class, table grain |
| A3 candidates | Yes | Containment both ways after normalisation, uniqueness, name similarity, format match; "no reliable join" + 3 near-misses |
| A4 normalise | Yes | trim, lower/upper, lpad, crosswalk (US state name/abbr/FIPS, country name/ISO2/ISO3), cast to date |
| A5 lift | Yes | Lift ≥ 3, columns with ≥ 3 distinct values, pattern not cause |
| A6 fan-out | Yes | Factor, plus a proposed aggregation, per-column choice, editable |
| A7 score | Yes | 0–100, "heuristic, not a probability", one-line reason with numbers |
| A8 approve/reject/edit | Yes | Edits recompute the receipt |
| A9 outputs | Yes | Joined CSV and Parquet, SQL, Python (pandas + duckdb), mapping.yml; byte-identical regeneration tested |
| A10 samples | Synthetic stand-ins | Real federal datasets need a download and picking; open question in the PRD |
| A17 AI drafts | Yes, wired for Anthropic, OpenAI-compatible (incl. Ollama) | Closed grammar validator, every draft executed and scored before display |
| A18 before/after | Yes | N sample rows raw vs transformed + match-rate change |
| A19 payload panel | Yes | Exact payload shown; masked by default; raw is a toggle |
| A22 a11y | Basics | Semantic receipt markup, keyboard approve/reject, labelled controls |
| Fixture accuracy | Yes, generated | 30+ labelled pairs from seed-fixed broken copies; runner prints top-1 |
| Repo P0 | README, ADRs, CI workflow file, MIT | No GitHub remote (Joel said local); GIF and live demo need a deploy |

## 2. Approaches considered

1. **DuckDB does all the counting; TypeScript decides (chosen).** Every number on a receipt comes from a SQL query run by DuckDB (Wasm in the browser, `@duckdb/node-api` in tests and the CLI). TypeScript builds the queries from a typed plan, reads back small result sets, and makes decisions. Fits the PRD's "every number comes from SQL", handles 200 MB, and the same core runs in both runtimes.
2. **Pure TypeScript in memory.** Simpler to test, but 200 MB of CSV parsed into JS objects blows browser memory, and the numbers wouldn't come from the SQL the user takes home.
3. **Small local server.** Easiest DuckDB story, but breaks "no backend" and "nothing leaves the browser".

## 3. Repo and packages

New repo `data-tools` (the family doc's recommended monorepo), npm workspaces:

```
packages/core/            engine-agnostic library: plan types, SQL emit, profiling, keys, receipts, mapping.yml, Python emit, AI grammar
packages/core-node/       Db adapter over @duckdb/node-api (tests, fixtures, future CLI)
packages/join-receipt/    the web app (Vite + React + DuckDB-Wasm), dev port 3066
fixtures/join-receipt/    generator + labelled pairs + accuracy runner
docs/adr/                 decision records
```

`core` never imports DuckDB. It talks to one interface:

```ts
interface Db {
  query(sql: string): Promise<Record<string, unknown>[]>;   // rows as plain JS (BigInt → number where safe)
  registerFile(name: string, bytes: Uint8Array): Promise<void>;
}
```

## 4. The core pipeline

```
files ─load→ tables ─profile→ TableProfile[] ─candidates→ JoinCandidate[] ─receipt→ Receipt
                                                    ↑ normalisations (grammar ops)        │
                                                    └── AI drafts (validated ops) ────────┘
approved receipts → mapping.yml → { SQL, Python, joined data }
```

**Plan types are the closed grammar.** One discriminated union (`Op`) is used by rules, the user and the AI alike:

```ts
type Transform =
  | { op: 'trim' } | { op: 'lower' } | { op: 'upper' }
  | { op: 'lpad'; width: number; fill: string }
  | { op: 'crosswalk'; table: 'us_state' | 'country'; from: Code; to: Code }
  | { op: 'cast'; to: 'varchar' | 'integer' | 'date' }
  | { op: 'date_trunc'; unit: 'day' | 'month' | 'year' };
type Aggregate = { op: 'aggregate'; by: string[]; measures: { column: string; fn: 'sum'|'avg'|'min'|'max'|'count'|'first' }[] };
type JoinOn = { op: 'join_on'; left: KeyRef; right: KeyRef; how: 'inner' | 'left' };
// KeyRef = { table, column, transforms: Transform[] }
```

The AI may only return JSON that parses into these types (validated by a hand-written validator, no `eval`, no SQL strings). Column and table names are checked against the profiled schema. Anything else is rejected with the reason shown.

**SQL is emitted from the plan by one module** (`sql/emit.ts`): identifiers always double-quoted and escaped, literals escaped, crosswalks emitted as inline `VALUES` CTEs so the SQL the user takes home is self-contained and portable (DuckDB and Postgres). The receipt queries and the exported SQL share the same expression emitter, so the numbers on screen come from the same expressions the user downloads.

**Profiling** (`profile.ts`): one aggregate query per table for row count, and per column: `count(distinct)`, null count, min/max length, and a sample of up to 200 distinct non-null values for the format classifier. Large tables (> 1M rows) profile on a `USING SAMPLE` labelled as a sample; joins and uniqueness always run on full data. Format classes come from TS regexes on the sample plus distinct-count and name hints: `us_state_fips`, `county_fips`, `us_state_abbr`, `us_state_name`, `iso2`, `iso3`, `country_name`, `zip5`, `email`, `date`, `timestamp`, `year`, `currency`, `integer_id`, `numeric`, `free_text`, `categorical`, `unknown`. Grain: the smallest set of ≤ 2 columns that is unique (single unique column first; otherwise a pair among low-null, non-measure columns), reported as "one row per …".

**Candidates** (`candidates.ts`): for each pair of tables, for each column pair with compatible format families and plausible types, run a containment query on the distinct values: raw first, then with the normalisation chain the format pair suggests (e.g. integer vs zero-padded string → `cast varchar` + `lpad`; state name vs abbr → `crosswalk`). Keep the best chain per pair. Pairs are pruned before any query (name similarity, format family, distinct-count ratio) so a 20-column × 20-column pair doesn't run 400 queries. The best few hundred are cheap `count(distinct)` intersections.

**Score** (`score.ts`, A7): weighted sum of containment of the smaller side (dominant), uniqueness of at least one side, format match, name similarity, and a penalty for very low distinct counts (booleans/flags never join). The reason line cites its own numbers: "97% of left codes found after zero-padding; right side unique; names match (`fips` ↔ `county_fips`)." Below 50 with nothing over 60% containment → "no reliable join" with the top 3 near-misses.

**Receipt** (`receipt.ts`): for one `JoinOn` plus optional `Aggregate`s, computes matched / unmatched-left / unmatched-right row counts, the fan-out factor (`rows after join ÷ rows of the left`, plus max rows per key on each side), the transformations applied with before/after samples (A18), and the unmatched explanation (A5): for each column of the side with drops that has 3–50 distinct values, `lift = share of value among unmatched ÷ share among all`; report the top 1–2 values with lift ≥ 3 and count ≥ 3, phrased as "all 34 unmatched rows have state = AK (AK is 1% of the file)". Fan-out > 1.05 proposes an `Aggregate` on the many side by the key, measures `sum` for numeric non-key columns and `first` for the rest, each editable.

**mapping.yml** (`mapping.ts`): deterministic YAML written by our own small serializer (sorted keys, fixed number formatting) so the same decisions always produce the same bytes. Shape:

```yaml
tool: join-receipt
version: 0.1.0
tables: { counties: { file: counties.csv, grain: [fips] }, ... }
joins:
  - id: counties__unemployment
    left: { table: counties, column: fips, transforms: [ { op: cast, to: varchar }, { op: lpad, width: 5, fill: '0' } ] }
    right: { table: unemployment, column: county_fips, transforms: [] }
    how: left
    aggregate_right: null
    status: approved
    proposed_by: rule        # rule | llm | user
    llm: null                # { model, prompt_sha256 } when proposed_by: llm
    receipt: { matched: 3108, unmatched_left: 34, unmatched_right: 0, fanout: 1.0 }
```

**Emitters**: `emitSql(mapping)` → one `CREATE VIEW`-free SELECT script with CTEs (`read_csv_auto` source lines commented with the file name so it runs in DuckDB as-is; table names for Postgres users). `emitPython(mapping, 'pandas' | 'duckdb')` → text. The pandas snippet uses `str.zfill`, `str.strip`, `str.lower`, a crosswalk dict, `groupby().agg()`, and `merge(validate=..., indicator=True)` and asserts the expected row count from the receipt. Both are pure functions of mapping.yml; a test regenerates them twice and compares bytes.

**AI layer** (`ai/`): `buildPayload(profiles, candidate, mode: 'masked' | 'raw')` returns the exact object that would be sent; masked samples keep shape only (digits → `9`, letters → `a`/`A`, length kept) except values from public code lists (state/country codes), which are not personal. `providers.ts` calls Anthropic Messages or any OpenAI-compatible endpoint (Ollama's `/v1/chat/completions`) with `fetch`, asks for JSON only, parses, validates against the grammar, then every valid proposal runs through the same receipt engine and is shown with its match-rate change. The prompt text is a constant; its SHA-256 goes into mapping.yml. Default model ids are editable text fields.

## 5. The web app

One page, top to bottom (this is a functional layout, not a picked look: Joel picks visual direction, so the styling is deliberately plain and themable, with a receipt-paper card for the receipt itself as the one opinion):

1. **Header + drop zone.** "Try the sample data" button and file picker/drop. A line under it: "Nothing leaves your browser unless you connect a model."
2. **Files.** One card per table: rows, grain ("one row per county × year"), columns with type, format chip, distinct, null %, unique marker.
3. **Proposed joins.** Ranked list. Each is a receipt card: score + reason, matched/unmatched counts, normalisations with before/after rows, the unmatched pattern line, fan-out warning with the aggregation editor, join type, Approve / Reject. Editing a transform or aggregation recomputes the card.
4. **AI drafts** (collapsed by default). Provider, endpoint, model, key (kept in memory only, never stored), payload preview with masked/raw toggle, "Draft a fix" per receipt. Drafts appear as extra options on the card, labelled "drafted by <model>", with their own before/after and score; rejected drafts show why.
5. **Take it with you.** Downloads: joined CSV, joined Parquet, `join.sql`, `join_pandas.py`, `join_duckdb.py`, `mapping.yml`; code shown in tabs with copy buttons.

State lives in one reducer; every recompute is async and cancels the previous one for that card.

## 6. Fixtures and accuracy

`fixtures/join-receipt/generate.ts` builds, from a fixed seed, ~10 base tables (US states, synthetic counties with real-shaped FIPS, countries, a customer/order pair, a daily/yearly pair) and from them **36 labelled pairs**: clean joins, unpadded codes, case/whitespace drift, name vs code, wrong-but-tempting decoys (two integer id columns with overlapping ranges), grain mismatches, and 4 pairs with no real key. Each pair has `label.json` with the correct `join_on` or `none`. `accuracy.ts` runs the core on every pair with node DuckDB and prints top-1 accuracy, "no join" precision, and failures; the README quotes the number and CI regenerates it. Real public joins (Census/BLS) are added when Joel picks datasets; until then the README says the set is synthetic.

## 7. Testing

Vitest, against real DuckDB (node adapter), no mocks for SQL. Unit tests per module (emitter escaping, grammar validator rejects, lift math, fan-out factor, YAML determinism), integration tests on fixture pairs, and a browser check of the sample flow by hand (screenshots) at 390 px and 1280 px.

## 8. Errors

Each file that fails to load names the file and the DuckDB error in one line and the others carry on. A provider error shows the HTTP status and message, never the key. Recompute failures leave the last good receipt and show the error on the card.

## 9. Decisions I made (Joel can overrule)

1. **Repo:** new local monorepo `~/Claude Code/data-tools`, no GitHub remote yet (you said local; creating a public repo is your call).
2. **Excel deferred.** The npm `xlsx` package is frozen at 0.18.5 with known advisories, and the DuckDB Excel extension in Wasm is unverified. Better to ship four formats cleanly than parse untrusted spreadsheets with a stale library.
3. **Synthetic samples** stand in for the federal datasets until you pick them (the PRD lists this as open).
4. **Plain styling**, receipt-paper card. The look is yours to pick before launch.
5. **Dev port 3066** (next free after stay-on-your-side's 3065).
6. **Providers:** Anthropic and OpenAI-compatible (covers Ollama, OpenAI, many local servers). Gemini later.
