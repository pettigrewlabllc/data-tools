# Fable review: Determinism Profiler value statements

**Date:** 2026-11-09 · **Reviewer:** plan-reviewer (Fable) · **Input:** `../specs/2026-11-09-determinism-profiler-value.md` (pre-review wording, in git history) and the PRD

**Verdict:** rework needed (one blocker, notebook attribution; otherwise proceed).

## Per statement

- **V1 (notebook, which cell started it).** Holds narrower. nbval re-executes and reports per cell which outputs differ ([nbval](https://nbval.readthedocs.io/)); Osiris (ASE 2020) re-executes and compares cell outputs. Neither says which cell *started* it. **Not delivered as architected:** D2 compares cell outputs, cells have no declared inputs, and the usual culprit (`df = df.sample(100)`, set iteration under a fresh `PYTHONHASHSEED`) prints nothing, so D4 can't fire and blame lands on a downstream `df.head()`. Needs kernel instrumentation (hash the variables a cell reads and writes).
- **V2 (dbt, origin vs propagation).** Holds narrower. Recce does per-model diffs on a lineage graph and posts to PRs; Datafold's open-source data-diff was archived 2024-05-17; dbt's idempotency guidance is "run twice, compare row counts" by hand. Nothing separates origin from propagation for same-code reruns. Partly delivered: run_results.json has no output hashes (v1 must hash tables itself: dbt-duckdb only, or a macro per adapter); sources need hashing too or downstream models get misblamed; incremental models need `--full-refresh` every run.
- **V3 (cause with file and line).** Does not hold as worded: sqlfluff AM09 flags LIMIT without ORDER BY ([sqlfluff](https://docs.sqlfluff.com/en/stable/reference/rules/ambiguous.html)); pgvet has limit-without-order. No linter covers ties, now()/random(), unseeded `.sample()`, set order or float aggregation order. Ties aren't statically decidable; as a pure static check it fires on most window functions. The differentiator is cross-referencing a static candidate with an observed difference.
- **V4 (order vs rows vs values).** Holds narrowly (datacompy and Recce do it for two tables you point at, not for every step). Delivered by the two-checksum design.
- **V5 (PR artifact).** Holds narrower (Recce and Datafold post environment diffs to PRs; no run-to-run artifact). Dana will want `state:modified+` selection.
- **V6 (hash-only sharing).** Weak: DVC lock files already share per-stage hashes. The "no data values" test is unenforceable if traces hold SQL or cell source (literals like `where customer = 'Acme'`): exclude or hash source.
- **V7–V9 (v2).** V7 matches the PRD's 2026-11-08 finding (not re-verified). V8 holds. V9 is a feature looking for a user until a real judgment-step corpus exists; keep it out of v1 constraints.

## Ranked changes

1. **Blocker:** cell-level input/output state hashing for notebooks.
2. **Serious:** dbt `--full-refresh` every run; a moved source is "inconclusive", not blame; say which adapters v1 hashes.
3. **Serious:** ties only as "candidate, confirmed by an observed difference".
4. **Worth knowing:** concede sqlfluff AM09 in V3; hedge V6; add `state:modified+` to D7.
5. **Cut candidate:** the static HTML viewer adds nothing to the value statements.

Unchecked by the reviewer: Recce's exact PR-comment contents; whether any dbt adapter exposes a cheap uniform table checksum; the 2026 tool-calling study cited in PRD section 9.

## What we did with it

All of 1–4 went into the v1 design. On 5, the HTML viewer stays because it's P0 in the PRD and is a render of the same report model; it's kept small.
