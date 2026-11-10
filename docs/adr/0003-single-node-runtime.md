# 3. One TypeScript runtime, DuckDB everywhere

Date: 2026-11-09 · Status: accepted

**Decision.** The engine is TypeScript over a three-method `Db` interface. DuckDB-Wasm backs it in the browser and `@duckdb/node-api` in tests and the CLI. No bundled Python, no Pyodide, no sqlglot; SQL is emitted by a small builder and Python is generated as text.

**Why.** One engine means the browser, the tests and the CLI agree. Pyodide plus sqlglot would add megabytes and seconds to the first receipt. Python output is verified by running it in tests when a Python with pandas is available.

**Cost.** Dialect translation is ours to write. v1 emits DuckDB SQL only.
