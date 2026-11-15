# Field Map v1: implementation plan

**Date:** 2026-11-14 · **PRD:** `docs/specs/2026-11-14-field-map-prd.md` · **Scope:** v1 web (F1–F11, F13, F14, repo P0)

## Base: standalone on main (Joel's call, 2026-11-14)

The PRD's open question said the build waits for Join Receipt's PR stack, because the core library lives only there. Joel chose to build standalone on `main` instead. So:

- Everything lives in `packages/field-map/`, with its own `package.json`, lockfile, tsconfig and vitest config. No root files are added, so the Join Receipt stack (which adds the root `package.json`, CI and README) merges without conflicts. Its own CI workflow is `.github/workflows/field-map.yml`.
- The few core helpers it needs are **copied** into `packages/field-map/src/shared/` with a header naming the source commit: the US state and country crosswalks, the OpenAI-compatible/Anthropic provider and JSON extraction. Value classification is rewritten for JSON values (core's `classifyColumn` reads DuckDB types). Folding these back into core is a follow-up once the stack merges.
- Once root workspaces exist (`packages/*`), the package is picked up as is.

## Modules (all in `packages/field-map/src/engine/`, plain TypeScript, no DOM)

| # | Module | Does | Tested by |
|---|---|---|---|
| 1 | `json.ts` | JSON parser that reads integers outside ±2^53 as strings and reports which paths had them; JSON / array / NDJSON / pasted text loading with per-file errors; picks the record root (a top-level array, or the one array of objects in an envelope like GeoJSON `features`) and lets it be overridden | `json.test.ts` |
| 2 | `profile.ts` + `formats.ts` | JSON path profiler: every path (`a.b`, `items[].sku`, `tags[]`), type mix, missing/null counts, distinct, samples, array depth, format class (core's set plus URL, UUID, epoch s/ms/µs/ns by magnitude), counts not percentages below 10 records | `profile.test.ts` |
| 3 | `target.ts` | JSON Schema (2020-12 / 07, local `$ref` only, remote `$ref` is a named error), example record → inferred schema (with loosening), column list → untyped fields; flattens to target fields with context (parent array) | `target.test.ts` |
| 4 | `grammar.ts` | The closed grammar types and `validateMapping()` (op cap 5, paths exist, nested one level) — the only way in for people and models | `grammar.test.ts` |
| 5 | `emit-jsonata.ts` | Grammar → JSONata text. Semantics per the PRD table: guarded `cast`, `values`/`nested` always arrays, `pick` takes first, missing parts in `concat` dropped with their separator | `emit.test.ts` (runs every op on edge inputs) |
| 6 | `canonical.ts` + `emit-pandas.ts` | Canonical form; grammar → pandas text; equivalence test runs both on every fixture when `FM_PYTHON` points at a Python with pandas | `equivalence.test.ts` |
| 7 | `names.ts` + `score.ts` + `recommend.ts` | Candidates per target field: name (tokens + synonyms), type, evidence, rule fit; rule-proposed transforms (F5); questions (F6, T = 60, G = 10); no good source (F8); thin samples (F9) | `recommend.test.ts` |
| 8 | `validate.ts` | Runs the mapping over every sample and validates against the target with ajv (`Ajv2020` / `Ajv` draft-07, `ajv-formats`); per-field and overall pass rates; per-field results checked against the full transform | `validate.test.ts` |
| 9 | `fieldmap-yml.ts` | Write and read `fieldmap.yml` (tool version, exact `jsonata` version, sample and target hashes); same file → byte-identical transform | `fieldmap.test.ts` |
| 10 | `ai/` | Payload builder (masked by shape, categorical pass-through ≤ 50 distinct and not email), provider (copied), draft parser that accepts only grammar JSON and runs every proposal through validation and scoring | `ai.test.ts` |

## Web (`packages/field-map/src/web/`)

Vite + React, engine in a worker. Port 3089 dev, 3090 preview (e2e). One screen: samples in, target in, a row per target field (grouped under its parent array), questions inline, approve/edit/reject, hide-values toggle, exports. Keyboard-only flow; axe scan in light and dark at 1280px and 390px. No network with AI off (e2e asserts it).

## Fixtures (`packages/field-map/fixtures/`)

- `download.ts` fetches the public API samples once and writes them with source URL, date and licence. Tests never touch the network.
- `tasks/*.json`: labelled mapping tasks, labels written before the engine is scored. Families from PRD §10 (renames, nesting, line items, three prices, names, epochs, cents, enum codes, sometimes-present, big integers, no good source, decoys). Some tasks wrap real responses; the families real APIs don't cover are built on top of the real payloads (renamed, nested or decoyed copies), and say so.
- `accuracy.ts` scores every task against every target kind it allows and writes `accuracy.json`: confident precision, coverage, questions per field, first-ranked accuracy, per target kind. CI regenerates it and fails on drift.
- Held-out set: not in this PR (needs someone else's schemas). Reported as not yet built.

## Order

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → fixtures → 10 → web → e2e → README + ADRs. One PR, against `main`.

## Not in this PR

Drift check (F15), CLI (F16), OpenAPI (F12) are v1.1. The held-out accuracy set. Folding `shared/` back into core.
