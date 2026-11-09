# Fable review of the v1 plan (2026-11-09)

Reviewer: plan-reviewer agent on Fable. Verdict: **build it after the blockers.** How each finding was handled is in the plan's "Review fold-in" section.

| # | Severity | Finding | Fix taken |
|---|---|---|---|
| 1 | blocker | DuckDB implicitly casts VARCHAR to BIGINT, so a raw `fips = county_fips` "matches" padded codes; receipt says no fix needed, exported pandas then finds 0 matches | Every key expression compares as text (`CAST(... AS VARCHAR)` outermost, and string ops cast first). Test asserts a raw int vs padded join matches 0 rows |
| 2 | serious | No penalty when neither side is unique, so a shared `state` or `year` column outranks the real key | −30 when neither side is unique; weights containment 0.45, uniqueness 0.25, format 0.15, name 0.15; decoy fixture family added |
| 3 | serious | Fan-out `joined/left` is masked by drops on inner joins; single-column keys can't express county × year | `fanout = joined / matched_left`; warn whenever max rows per key on the right > 1. Keys stay single-column in v1 (README says so); grain mismatches are fixed by rolling up |
| 4 | serious | pandas merges NaN keys to each other; global `dtype=str` breaks `sum` | `dtype={key: str}` for key columns only; drop null keys before merge; `validate='m:1'` only when the right side is unique |
| 5 | serious | Fixture accuracy is circular | Adversarial families added (shared non-unique dimension, decoy int ids with full containment, padded-vs-unpadded with unrelated names); README reports per family and says the set is synthetic. Real public files not downloaded in an unattended session |
| 6 | worth knowing | Crosswalk scalar subquery errors on duplicate matches; TRY_CAST isn't Postgres | `LIMIT 1` plus a uniqueness test; SQL header says DuckDB SQL, Postgres in v1.1 |
| 7 | worth knowing | Value types differ between node and Wasm (HUGEINT, Decimal) | Display values selected as VARCHAR; Wasm opened with `castBigIntToDouble` and `castDecimalToDouble` |
| 8 | worth knowing | JSON may autoload an extension; Ollama CORS is loopback-only; Anthropic needs `max_tokens` | Privacy line says "no request carries your data"; AI panel shows the `OLLAMA_ORIGINS` command; `max_tokens: 1024` |
| 9 | worth knowing | YAML round-trip breaks on number-like strings (`'0'`, `'01001'`, `'null'`) | Serialize with the `yaml` package (it quotes ambiguous strings), fixed key order; round-trip test uses those values |
| 10 | scope | 11 tasks in 90 minutes is not realistic | Order kept; Parquet download and duckdb-Python flavour cut; AI layer keeps live providers but tests use a fake fetch |
