# 0007. The profiler is a Node tool and uses the user's own Python

**Status:** accepted · 2026-11-09 (extends 0003, single Node runtime)

## Decision

The profiler ships no Python. Notebooks run through the user's own `jupyter nbconvert --execute` with the notebook's own kernel; dbt runs through the user's own `dbt`. The Python the profiler needs (a parser for cell def-use, and the fingerprint helper pasted into the instrumented notebook) ships as strings in `src/runners/notebook-python.ts` and runs in that environment.

## Why

Anyone profiling a notebook already has Jupyter and their packages; a bundled Python would be a second environment with different package versions, which is its own source of "different answer each run". Running in the user's environment measures what they actually run.

## Consequences

- When `jupyter` or `dbt` isn't found, the profiler exits 2 with what to install or which flag to pass.
- The fingerprint helper needs pandas and numpy only for DataFrames and arrays; plain Python values work without them.
- v1 reads dbt results from a DuckDB file only (dbt-duckdb). Other adapters get `--static-only`.
