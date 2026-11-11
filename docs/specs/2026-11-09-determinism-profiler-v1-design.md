# Determinism Profiler v1: design spec

**Date:** 2026-11-09 · **Status:** draft for Fable review · **PRD:** `2026-11-09-determinism-profiler-prd.md` · **Value statements (post-review):** `2026-11-09-determinism-profiler-value.md`

v1 is the CLI: PRD requirements D1–D7 plus the repo P0 items. It is built to make value statements V1–V6 true. Each design choice below names the statement it serves.

## 1. What a user does

```
npx determinism-profiler analysis.ipynb            # notebook
npx determinism-profiler sql/                      # folder of .sql files, run in DuckDB
npx determinism-profiler my_dbt_project/           # dbt project on dbt-duckdb
```

Options: `--runs N` (default 3, min 2) · `--cells 2,4-6` (notebook subset) · `--select <names|selector>` (SQL subset by file or table name; dbt selector passed through, so `state:modified+` works) · `--out DIR` (default `./.determinism`) · `--fail-on differs|never` (default `differs`) · `--static-only` (no runs) · `--jupyter PATH` / `--dbt PATH` / `--kernel NAME` · `--duckdb-path PATH` (dbt, when profiles.yml can't be read).

Exit codes: `0` every scored step matched · `1` at least one step differed · `2` usage or environment error (no jupyter, no dbt, unsupported adapter, parse failure).

It writes `trace-run-<i>.json` per run, `report.json`, `report.md`, `report.html` to `--out`, and prints the terminal report.

Input kind is detected: a `.ipynb` file → notebook; a directory with `dbt_project.yml` → dbt; a `.sql` file or a directory containing `.sql` files → SQL.

## 2. Steps, outputs, verdicts

A **step** is a notebook code cell, a SQL statement that produces a result or a relation, a dbt model/seed/snapshot, or a **source** (a data file read by the analysis, a dbt source). Sources aren't blamed; they're hashed so a moved source is visible (V2).

### Output fingerprint (V4)

Every tabular output gets one fingerprint:

| Field | Meaning |
|---|---|
| `rows` | row count |
| `ordered` | SHA-256 over canonical row encodings in output order |
| `unordered` | sum of per-row digests mod 2^128 (commutative, duplicate-safe) |
| `rounded` | `unordered` recomputed with non-integer numbers at 10 significant digits |
| `columns` | per-column unordered digest, so the report can say *which* columns moved |
| `order_matters` | false for persisted tables, views and dbt models (their row order isn't defined); true for SELECT results, notebook DataFrames/Series/arrays/lists and displayed output |

Scalars and Python objects get a fingerprint with `rows: 1`. Python `set`/`frozenset`/`dict` keys hash unordered; lists/tuples hash ordered. Images and widgets are **skipped with a note** (PRD open question, resolved as "skip and say so").

### Verdict per step (compare all N runs)

| Verdict | Rule |
|---|---|
| `same` | `ordered` equal in all runs (or `unordered` equal when `order_matters` is false) |
| `order` | `unordered` equal, `ordered` differs, `order_matters` true |
| `float` | `unordered` differs, `rounded` equal |
| `values` | `rows` equal, `unordered` differs |
| `rows` | `rows` differs |
| `skipped` | nothing hashable |

A notebook cell can have several outputs (each variable it wrote, plus its display); its verdict is the worst across them, in the order rows > values > float > order > same.

### Attribution (D4, V1, V2)

For each step whose verdict isn't `same`:

- **origin**: every input hash was identical across runs. This step introduced the difference. It's blamed.
- **inherited**: at least one input differed. The report names the upstream origin(s), found by walking parents to the nearest steps marked origin. (It may also add variance of its own; if a static finding on it says so, the report says "also check".)
- **inconclusive**: an input that differed is a source (a file or dbt source that changed between runs). Nothing downstream is blamed; the report says the sources moved.

Steps marked **judgment** (AI calls, §5) are reported separately and left out of the score. **Score** = steps `same` / scored steps (excludes judgment, skipped, sources).

Input identity uses the same `order_matters` rule as the verdict: a table that came back shuffled counts as an identical input. That's what lets the tie fixture blame the `ROW_NUMBER` step and not the shuffle (§7).

## 3. Notebooks (D2, the Fable blocker)

Cell outputs alone can't attribute: the cell that causes variance (`df = df.sample(100)`) usually prints nothing. So the profiler **instruments the kernel**:

1. **Preflight** (once, no kernel): the profiler runs a short Python script with the Python beside the `jupyter` executable (fallback `python3`). It parses each code cell with `ast` (lines starting with `%` or `!` blanked first) and returns per cell: names stored at top level, names loaded, and string literals. That gives a def-use graph and each cell's **parents** (the latest earlier cell that stored each name it loads).
2. **Instrumented copy**: the profiler writes a temporary copy of the notebook with a setup cell first and two hidden cells around each user code cell:
   - *pre-cell*: fingerprints the names the cell loads (from the current kernel state) and the bytes of any string literal that is an existing file path relative to the notebook → the cell's **inputs**.
   - *post-cell*: fingerprints the names the cell stored **or loaded** (loaded catches in-place mutation like `df['x'] = ...` or `df.drop(..., inplace=True)`) → the cell's **outputs**.
   They append JSON lines to a temp file whose path is baked into the setup cell. Nothing is printed, so user cell outputs are unchanged.
3. **Execute** with `jupyter nbconvert --to notebook --execute --output-dir <tmp>` per run, cwd = the notebook's folder, fresh kernel each run (so `PYTHONHASHSEED` and unseeded RNGs vary, as they do for a real rerun).
4. The display output of each user cell (stream text, `text/plain` of results and displays, with `0x…` memory addresses masked) is fingerprinted from the executed copy as one more output.

Fingerprinting in the kernel: pandas objects via `pandas.util.hash_pandas_object` (rows, index included) feeding the ordered/unordered/rounded/column digests; numpy arrays by bytes per row; other objects by `repr` with addresses masked. Modules, functions and classes are ignored.

Known limit, stated in the report notes: mutation through a function call the cell doesn't name (e.g. `clean(df)` mutating `df` in place) is caught because `df` is loaded; mutation of a global the cell never mentions is not.

**Subset (`--cells`, D7):** the chosen cells (1-based code-cell numbers) plus their transitive parents from the def-use graph run; other cells are left out of the executed copy. The report lists which cells were included and why.

Missing jupyter: exit 2 with "Couldn't find jupyter. Install it (pip install notebook) or pass --jupyter PATH." (final wording via joel-voice).

## 4. SQL folder (D2)

- Files: every `*.sql` under the path, sorted by relative path. Each file is split into statements by a splitter that respects quotes, comments and `$$` strings and keeps line numbers.
- Each run is a fresh in-memory DuckDB with cwd set to the SQL folder, so relative `read_csv('data/x.csv')` works.
- Steps: `CREATE [OR REPLACE] [TEMP] TABLE|VIEW x AS …` (output = `SELECT * FROM x`, `order_matters` false) · `INSERT INTO x …` / `UPDATE x` / `DELETE FROM x` (output = x after) · a top-level `SELECT` / `WITH` / `FROM` (output = its result, `order_matters` true) · `COPY … TO 'f'` (output = the written file's bytes). `SET`, `PRAGMA`, `INSTALL`, `LOAD`, `ATTACH` run but aren't steps.
- Parents: table names from DuckDB's `json_serialize_sql` on the statement's query part (BASE_TABLE nodes), each mapped to the last step that produced that table; quoted file paths in `read_*` calls or as table names become **source** steps (file bytes hashed each run). Regex fallback when the serializer can't parse it.
- `--select a.sql,orders` profiles the named steps and their transitive parents only.
- Results are streamed in chunks into the hasher; nothing is kept in memory but digests. v1 is meant for analysis-sized data (tested to a million rows); the README says so.

## 5. dbt (D2, V2, V5)

- v1 hashes **dbt-duckdb** only. Other adapters exit 2 with a message saying so; the static checks still run with `--static-only`.
- Each run: `dbt build --full-refresh --target-path <tmp>/run-i [--select …]` in the project folder. `--full-refresh` every run, because otherwise runs 2..N measure incremental logic, not determinism.
- After each run, the profiler opens the DuckDB file **read-only** (path from `profiles.yml` in the project or `~/.dbt`, or `--duckdb-path`) and fingerprints every built model, seed and snapshot (`order_matters` false), plus every **source** relation. Parents come from `manifest.json` `depends_on.nodes`. Status and timing from `run_results.json`. Test nodes are recorded as pass/fail, not as steps.
- `--select` is passed straight to dbt, so `state:modified+` works. For a consistency check of only the chosen models with their inputs, the profiler expands a bare name `x` to `+x`.

## 6. Static checks (D5, V3)

Run before any execution, on SQL files, dbt model files (Jinja blanked out with newlines kept, `{{ ref('x') }}` → `x`, so line numbers match the source file) and notebook code cells (line = line within the cell, reported as `cell 4, line 2`).

| Cause | SQL | Python | Kind |
|---|---|---|---|
| Timestamp | `now()`, `current_timestamp`, `current_date`, `get_current_time`, `today()`, `localtimestamp` | `datetime.now/today/utcnow`, `date.today`, `time.time`, `pd.Timestamp.now`, `pd.Timestamp('now')` | definite |
| Random | `random()`, `uuid()`, `gen_random_uuid()` with no `setseed` earlier | `np.random.*` / `random.*` draws with no seed call earlier in the notebook; `default_rng()` with no argument | definite |
| Unseeded sample | `USING SAMPLE` / `TABLESAMPLE` without `REPEATABLE (n)` | `.sample(` without `random_state=`; `train_test_split(` without `random_state=`; `shuffle(` | definite |
| Unordered limit | `LIMIT` with no `ORDER BY` at the same query level | `.head(`/`.iloc[:n]` straight after `drop_duplicates`/`groupby(...).first()` with no sort | candidate |
| Ties | `ORDER BY` inside `ROW_NUMBER() OVER (...)` (and `QUALIFY` on it); `ORDER BY … LIMIT` | `.sort_values(...).head(` / `nlargest(` / `nsmallest(` | candidate |
| Set order | `string_agg` / `array_agg` / `list` / `group_concat` without `ORDER BY` inside; `first()`, `last()`, `any_value()`, `arbitrary()` | iterating or `list()`-ing a `set(...)` | definite (SQL aggregates), candidate (Python sets of non-strings) |
| Float aggregation order | seen at runtime: verdict `float` | seen at runtime: verdict `float` | runtime |
| AI step | (none) | calls to `openai`, `anthropic`, `google.genai`, `ollama`, `litellm`, `.chat.completions.create`, `.messages.create`, `generate_content` | judgment |

**Status of each finding after the runs:**

- **confirmed**: its step differed and was the origin.
- **latent**: definite cause, step matched in all N runs ("could vary; didn't in 3 runs").
- **candidate**: tie or unordered-limit pattern, step matched. Shown in a quieter section, never in the headline count (Fable finding 3).
- **upstream**: its step differed but inherited it.

Findings carry file, line, cause and the matched keyword only. No source text (§8).

## 7. Fixtures and the accuracy number (D3, D4, D5, success metrics)

`fixtures/determinism-profiler/<case>/` each with `expected.json` naming the expected origin, inherited, same and static findings (file, line, cause, status).

| Case | Plants | Proves |
|---|---|---|
| `sql-clean` | 3-file deterministic pipeline | 100% score, zero findings (false-positive floor) |
| `sql-now-upstream` | `now()` in step 1, two steps downstream | D4: step 1 origin, the rest inherited |
| `sql-sample` | `USING SAMPLE 10%` | unseeded sample, confirmed |
| `sql-ties` | upstream table shuffled with `ORDER BY random()`, then `ROW_NUMBER() OVER (PARTITION BY g ORDER BY score)` with ties | shuffled table counts as identical input; the ROW_NUMBER step is the origin; tie finding confirmed |
| `sql-agg-order` | `string_agg` without ORDER BY and a `sum` of doubles over a shuffled input | set order confirmed; `float` verdict |
| `sql-limit` | `LIMIT 5` without ORDER BY | finding is a candidate; the run matches (honest: DuckDB is stable here) |
| `nb-clean` | seeded pandas notebook | 100% |
| `nb-sample` | silent `df = df.sample(frac=.5)` in cell 2, groupby in 3, display in 4 | Fable's blocker: cell 2 origin, not cell 4 |
| `nb-set-order` | `list(set(names))` of strings | set order across kernels (PYTHONHASHSEED) |
| `nb-now` | `datetime.now()` column | timestamp |
| `nb-ai` | a cell calling a stand-in `client.messages.create` | judgment, excluded from score |
| `dbt-duckdb` | seed + clean staging model + a model with `using sample` + a downstream report model | dbt origin vs inherited; `--full-refresh`; source hashing |

`npm run accuracy` runs every case with `--runs 3` and writes `fixtures/determinism-profiler/accuracy.json`: planted causes detected, attribution correct, false-positive findings on clean cases. CI fails if the file changes (same pattern as Join Receipt). Target: 100 / 100 / 0.

## 8. Traces hold no data (D1, V6)

Trace schema `determinism-profiler/trace@1`: tool version, input kind and relative name, run number, start time, and steps with `step_id`, `kind`, `parents`, `location` (file, line or cell number), `source_hash`, `input_hashes` (map of input id → fingerprint digest), `outputs` (name → fingerprint), `params` (runs, kernel, dbt command flags, never SQL or code), `duration_ms`, `status`.

Names (file, table, column, variable) are kept; they're metadata a user needs to act. Values and source text never appear. Enforced by a test: fixtures carry canary values (`CANARY_7f3a`, `987654.321`) in data and in SQL/code literals, and the test scans every file in `--out` for them.

## 9. Report (D6)

One `report.json` model, rendered three ways with the same content: terminal (plain text, colour only when stdout is a TTY), Markdown (made to paste into a PR, V5), and a single static `report.html` with the JSON inlined, no network requests. Order: the score line, origins (what to fix first, each with its findings), inherited steps (grouped under their origin), inconclusive steps and moved sources, latent findings, candidates, judgment steps, notes (skipped outputs, subset scope, limits).

The HTML look is a plain, readable default for now. The family's tools each have a chosen look (Join Receipt: Till; Answerability Check: Terminal); this one's look is Joel's pick and isn't decided here.

## 10. Code layout

```
packages/determinism-profiler/
  src/cli.ts            args, input detection, exit codes
  src/fingerprint.ts    canonical encoding, ordered/unordered/rounded/column digests
  src/compare.ts        verdicts, attribution, score
  src/static/sql.ts     tokenizer, statement splitter, SQL checks
  src/static/python.ts  Python cell checks
  src/runners/sql.ts    DuckDB runner
  src/runners/notebook.ts + notebook_helper.py.ts (Python snippets as strings)
  src/runners/dbt.ts
  src/report/{model,terminal,markdown,html}.ts
  src/trace.ts          schema types and writer
  test/*.test.ts        vitest
fixtures/determinism-profiler/   cases + accuracy.mts + accuracy.json; real/ for real-data checks
docs/adr/0005-hash-only-traces.md, 0006-attribution-rule.md, 0007-no-bundled-python.md
.github/workflows/determinism-profiler.yml
```

Self-contained package (own `package.json`, own devDependencies) so it builds on this branch without the Join Receipt stack, and joins the root workspace when that lands. Dependencies: `@duckdb/node-api`, `yaml`. No core-library use in v1: nothing it needs exists there yet.

## 11. Out of v1

Agent traces (D8), the study (D9), learned decisions (D10), non-DuckDB dbt adapters, parallel runs, a GIF in the README (a screenshot of the HTML report stands in until the look is picked).

## 12. Changes after Fable's spec review

Review: `../reviews/2026-11-09-determinism-profiler-spec-review.md`. These override the sections above where they differ.

- **§3 files:** a path literal counts only as an argument of a read call (input, hashed in the pre-cell; parent = last cell that wrote that path, else a source) or a write call (output `file:<path>`, hashed in the post-cell). This is how "saved frames" are covered.
- **§3 fingerprinting:** rows hashed without the index; the index is the `(index)` column digest; columns `hash_pandas_object` can't handle fall back to masked `repr` text.
- **§3 def-use:** loads inside function bodies aren't the defining cell's loads; they're recorded on the function and added to any later cell that calls it.
- **§3 subset:** cells with no stores and import cells are always included.
- **§3 display:** stderr streams are excluded.
- **§4 parents:** token scan with CTE names removed; no `json_serialize_sql`.
- **§5 dbt:** `:memory:` exits 2; views are a stated limit.
- **§6:** no Python unordered-limit check; `shuffle(`/`.sample(` check `random_state`; `sorted(set(…))` and `len(set(…))` exempt.
- **§7:** the clean-case false-positive number counts definite findings only; candidates are reported separately.
- **§8:** errors keep their class or kind only, never the message; params keep flag names, not values.
