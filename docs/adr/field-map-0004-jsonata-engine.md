# Field Map ADR 0004: JSONata is the engine for nested JSON

**Status:** accepted, 2026-11-14

The family's rule is that AI proposes and a local engine decides. For tables that engine is SQL in DuckDB. Payloads from an API are nested, and flattening them into tables first would mean the numbers on screen came from a different program than the one the user takes home. So Field Map compiles the grammar to JSONata (MIT, plain JavaScript, `jsonata@2.2.2` pinned exactly), runs it on screen and in validation, and the user downloads that same text. `evaluate()` is async in 2.x, so the engine is async throughout and runs in a Web Worker.

Python is generated from the same grammar and tested against the JSONata output, not the other way round. There's no DuckDB in v1; it comes back with tabular targets and the SQL emitter.
