# Field Map ADR 0001: a closed grammar, and one canonical form for comparing outputs

**Status:** accepted, 2026-11-14

Every mapping is written in a small grammar: `path`, `coalesce`, `concat`, `pick`, `values`, `count`, `constant`, `nested` for the source, and `trim`, `lower`, `upper`, `cast`, `parse_date`, `scale`, `value_map` as transforms, at most five ops per field (`packages/field-map/src/engine/grammar.ts`). Rules, people and models all go through `validateMapping`; nothing else becomes a transform. Raw JSONata is never accepted in v1.

The grammar compiles to two languages, JSONata and Python, and they have to agree. The semantics both emitters meet:

- Missing and `null` are the same. A path that ends in `null` reads as missing, and an object whose fields are all missing is missing.
- `values` and `nested` always give an array, including for one item and for none. (JSONata would otherwise return a one-item sequence as the bare value.)
- `cast` never throws. A value that won't convert is missing. Numbers written as text are read up to 15 digits; longer ones are missing, because JavaScript can't hold them exactly and Python can.
- `parse_date` reads ISO 8601 (an offset or `Z`; no offset means UTC, never local time, which is what JSONata's `$toMillis` would do), epoch s/ms/µs/ns, and `M/D/YYYY`. Impossible dates (February 31) are missing rather than rolled into March. Output is ISO 8601 in UTC with milliseconds.
- `trim` strips ASCII whitespace at the ends only. JSONata's `$trim` also collapses inner spaces, so it isn't used.
- `lower` and `upper` use each runtime's default case mapping. Known differences (Turkish dotted I, German ß) are not papered over; none of the fixtures hit them.
- `pick` with a key compares with JSONata's equality: `true` isn't `1` and `"1"` isn't `1`.
- Numbers turned into text print the way JavaScript prints them after JSONata's 15-significant-digit rounding (`0.1 + 0.2` is `"0.3"`, `1e-7` is `"1e-7"`).
- Integers outside ±2^53 are read as text at load time, and the field is flagged. A target that wants a number for one gets a question, not a silent cast.

**Canonical form**, used by the equivalence test: missing and `null` are equal, arrays stay arrays, integers compare exactly, other numbers compare at 15 significant digits, strings compare after Unicode NFC, object keys are sorted.

The test that holds this: `test/emit.test.ts` runs every op on inputs built to break a naive emitter, and `test/fixtures.test.ts` runs every fixture's mapping through both emitters and compares them in canonical form (`FM_PYTHON` points at a Python with pandas).
