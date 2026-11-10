# 0006. Blame a step only when its inputs were identical across runs

**Status:** accepted · 2026-11-09

## Decision

For each step whose output differs between runs:

- **origin**: every input hash was the same in every run, so this step introduced the difference. Only origins are blamed.
- **inherited**: an input differed. The report walks back through changed inputs to the origins, walking *through* steps that passed a changed input along without changing their own output.
- **inconclusive**: a changed input traces back to a source (a data file or dbt source) that was different between runs. Nothing is blamed.

Input identity follows the output's own rule: for tables, views and dbt models row order isn't defined, so a reshuffled table counts as the same input. For query results, DataFrames and lists, order counts.

## Why

A plain diff of two runs flags every step downstream of the problem. In a 20-model dbt project that's 20 red rows and no answer. The value of the tool (value statements V1, V2) is pointing at the one step to fix.

## Consequences

- An inherited step can also add variance of its own; the report can't tell, and says "also check" when a static finding sits on it.
- Notebook cells have no declared inputs, so the profiler instruments the kernel: a hidden cell before each user cell fingerprints the names it reads and the files it opens, and one after fingerprints what it wrote. Without that, the cell that causes variance (`df = df.sample(100)`) usually prints nothing and the blame lands three cells later (Fable's blocker, `../reviews/2026-11-09-determinism-profiler-value-review.md`).
- Proved on fixtures: `sql-now-upstream`, `nb-sample`, `nb-passthrough`, `sql-ties`, `dbt-duckdb`.
