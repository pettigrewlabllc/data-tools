# 0005. Determinism Profiler traces hold hashes, never values

**Status:** accepted · 2026-11-09

## Decision

A trace and a report store, per step output: a row count, an ordered digest, an order-insensitive digest, a digest with decimals cut to 10 significant digits, and one digest per column. Names (files, tables, columns, variables) are kept because a user needs them to act. Data values, SQL text and cell source are never stored; code is kept as a hash. Error messages are reduced to their kind (`Conversion Error`, `ValueError`) because they routinely quote the value that failed.

## Why

People profile confidential data and want to share the result in a PR or an issue. A trace that might contain a value can't be shared without reading it first, which nobody does.

## How it's enforced

Fixtures plant canary values in data, in SQL and code literals, in a failing CAST and in a cell that raises on the canary. `test/integration.test.ts` scans every file the profiler writes for them.

## Cost

Two runs that differ can't be diffed row by row from the trace. The report names the columns that moved and the row counts per run; to see the rows, rerun the step yourself.
