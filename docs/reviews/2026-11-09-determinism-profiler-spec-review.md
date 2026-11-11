# Fable review: Determinism Profiler v1 design spec

**Date:** 2026-11-09 · **Reviewer:** plan-reviewer (Fable) · **Input:** `../specs/2026-11-09-determinism-profiler-v1-design.md` (pre-review version in git history)

**Verdict:** build it after the blockers.

| Rank | Finding | Fix taken |
|---|---|---|
| blocker | Pre-cell hashes every existing string-literal path as an input, so a file the notebook *writes* (`df.to_csv('submission.csv')`) looks like a moved source on runs 2+; written files are never output fingerprints, so "saved frames" (D2) is uncovered | Paths classified by the call they sit in: `read_*`/`open(…,'r')`/`load*` → input (hashed pre-cell; parent is the last cell that wrote it, else a source); `to_*`/`savefig`/`save*`/`open(…,'w')` → output (hashed post-cell). Unclassified literals ignored |
| blocker | `hash_pandas_object` raises on object columns holding lists/dicts (measured, pandas 3.1.1); summing uint64 digests overflowed | Per-column fallback to masked `repr` text; mod-2^128 sums done safely |
| serious | Free variables inside notebook-defined functions: `def top(): return df.sample(5)` then `top()` blames the caller wrongly | Preflight records each top-level function's global loads; a cell calling it inherits those loads (one level) |
| serious | `--cells` closure drops side-effect-only cells (`np.random.seed(0)`, `pd.set_option`, imports) | Cells with no stores, and import cells, are always included; the scope note says so |
| serious | `json_serialize_sql` only parses SELECT; CTE names come back as tables | Parent detection is the token scan (the spec's fallback is the main path); CTE names defined in the statement are dropped |
| serious | D1 leak: error outputs and DuckDB errors quote values and source; dbt `--vars` in params | Errors stored as class/kind only; params hold flag names only; fixtures include an erroring cell and a failing CAST of the canary |
| serious | dbt: `:memory:` profiles, no `~/.dbt` here, views re-evaluated at hash time, external sources | Exit 2 on `:memory:`; fixture ships `profiles.yml`; fixture models are tables; views noted as a limit |
| worth knowing | Index in the row hash turns shuffle + `reset_index` into `values` | Rows hashed without the index; the index is its own column digest |
| worth knowing | Candidate noise vs the false-positive metric; `shuffle(…, random_state=0)`; `sorted(set(x))` | Candidates don't count toward the clean-case FP number; `random_state` checked; `sorted(`/`len(` exempt |
| worth knowing | stderr noise (logging, tqdm, warnings) makes a cell an origin with no cause | stderr streams excluded from the display fingerprint |

**Cut suggestions:** custom statement splitter (kept: already written and tested, keeps line numbers), COPY/INSERT/UPDATE/DELETE steps (kept: small), `--fail-on` and `--kernel` (kept: one line each), the Python unordered-limit check (cut), `.sort_values().head(` candidate (kept as a quiet candidate; it's the PRD's headline example), three ADRs → one (kept three, each short).

Unchecked by the reviewer: nbconvert kernel freshness and PYTHONHASHSEED per run, node-api chunk hashing and read-only open, report renderers, `state:modified+` pass-through. All are exercised by the fixtures.
