# Field Map: PRD

**Date:** 2026-11-14 · **Owner:** Joel · **Status:** draft (working name), revised after the Fable review (`docs/reviews/2026-11-14-field-map-prd-review.md`)

**One job:** take sample responses from an API and the shape you need, and recommend where every field comes from. It shows the evidence, asks you when it isn't sure, and gives you a transform you can keep, plus a check that tells you when the API changes shape.

**Stands alone:** needs only sample JSON and a target shape. Nothing from the other tools. Family overview and shared conventions: `2026-11-09-data-tools-family.md` (this PRD makes it a family of five, and changes one convention, see §8).

**Origin:** Joel, 2026-11-14, after a Gemini research pass: "auto mapping for a dynamic API, evaluating data context and giving recommendations for mapping as a tool." The evaluation is in lab-ops `docs/research/data-repos-for-data-tools-2026-11-14.md` §4c. Short version: the one tool that did this end to end (superglue, source-available under FSL) is deprecated per its README and went hosted; what's left is research code (bdi-kit, Valentine, PyDI, magneto) that works on tables in Python, or MCP proxies that expose an API without mapping anything.

**Home:** pettigrewlab.com/tools/field-map · `npx field-map`

## 1. PR/FAQ

Customer quotes are illustrative; launch copy gets its own joel-voice pass.

**Headline:** Field Map tells you where each field should come from, and asks when it isn't sure.

**Intro.** Paste a few responses from an API, or drop the JSON files. Give it the shape you need: a JSON Schema, an example record, or a list of columns. Field Map reads the actual values, not just the names, and proposes a source for every target field with the evidence beside it. Where two sources could fit, like three different prices in one payload, it asks you a question with real values from your data instead of guessing. You approve it, and you take home a transform (JSONata or pandas) and a `fieldmap.yml` that records every decision. Run the check again on next month's responses and it tells you which fields moved.

**The problem.** Mapping an API into your own schema is mostly guessing by field name. `price` could be the list price, the sale price or the unit price. `created` could be seconds or milliseconds. `amount: 1999` could be $19.99 or $1,999. The mapping runs either way. It just fills the wrong field quietly, and you find out when a report is off. AI mapping tools guess faster but say nothing about how sure they are, and the ones that "self-heal" when the API changes do it without asking.

**The solution.** Field Map does the checking a careful integration engineer would do and writes it down. For each target field it scores the candidate sources on name, type, format and how the values look, and shows why. When the top two are close, or nothing fits well, or the answer can't be known from values (cents or dollars), it asks. Every proposal is run on your samples and validated against the target before you see it. When the API changes, the check says what broke and proposes fixes, and nothing changes until you approve it.

> "Most mapping bugs aren't hard. They're quiet. A tool that says 'I'm not sure which of these is the price, here's what each one looks like' saves you the bug." Joel Pettigrew

**What the user experiences.**

1. Pastes twenty responses from a vendor's orders endpoint, or drops `orders.json`.
2. Pastes the target JSON Schema (or an example record, or a list of column names).
3. Sees a row per target field, grouped under its parent where the target nests (an order's `items[]`): the proposed source path, transforms, a score with its parts, and before/after sample values.
4. Answers two questions: "Which one is `price`?" with five real values under each option, and "Is `created` seconds or milliseconds?" with each reading shown as a date.
5. Downloads `fieldmap.yml`, `transform.jsonata` and a pandas snippet.
6. Next month, drops new responses into the check: "2 fields moved: `customer.email` is now `buyer.email_address`. 1 new field nobody maps."

**What it enables.**

| Who | With Field Map |
|---|---|
| Leo, integration developer (primary) | Maps a vendor API to his app's types in minutes, with the uncertain fields called out |
| Priya, Kaggle analyst | Turns nested API JSON into the flat table she wants without hand-writing `json_normalize` paths |
| Dana, platform lead | Runs the check in CI against recorded samples so a vendor change fails a build, not a report |
| Sam, someone hiring Joel | Sees the family's design (closed grammar, decision files, AI proposes and checks decide) on a second, different problem |

> Illustrative customer quote: "It asked me which of three prices I meant, with the actual numbers under each. That's the bug I would have shipped." Integration developer

**FAQ**

- *Does it call the API?* Not in the browser. You paste or drop responses. The CLI (v1.1) can fetch with `--url`, reading any auth header from an environment variable that's never written to a file.
- *Does my data leave my machine?* No, unless you connect a model, and then only what the payload panel shows.
- *Can I use the transform without the tool?* Yes. JSONata runs anywhere JavaScript runs; the pandas snippet needs only pandas. A community Python port of JSONata exists (jsonata-python); we test against the JavaScript reference only.
- *Does it fix mappings by itself when the API changes?* No. It detects the change and proposes fixes. You approve them.
- *What do I get with just a list of column names?* Matching by names and by what the values look like. Give an example record or a JSON Schema and it can also check types and rules.

## 2. Problem

Mapping JSON from an API into a known shape is done by eye: read the payload, guess which field is which, write the paths by hand. It fails quietly in four ways. **Ambiguity:** several fields could fill one target (three prices, two IDs, created vs updated). **Hidden meaning:** units, epochs, enum codes and nesting that names don't reveal, and some of it (cents vs dollars) that values can't reveal either. **Partial fit:** a field that matches 95% of records and breaks on the rest (nulls, an extra array level, a stray string). **Drift:** the vendor renames or nests a field and the mapping returns null, with no error. Today's options either map by name in a drag-and-drop UI, generate code silently with an LLM, or move data without mapping it to anyone's shape.

## 3. Goals

1. From "sample JSON + target shape" to a reviewed mapping, with every uncertain field called out, in under 5 minutes.
2. **When it's confident, it's right.** Wrong mappings presented confidently stay rare, without asking about everything (§10 defines both halves).
3. The decision is kept: `fieldmap.yml` regenerates the same transform text for a given tool version.
4. AI help that can't make things up: closed grammar, every proposal executed and validated before display.
5. Drift is caught: a check against new samples says what broke, field by field, with a CI exit code.
6. For Joel: a second tool that shows the family's design holds on a different problem.

## 4. Non-goals

| Non-goal | Why |
|---|---|
| Calling APIs from the browser, handling auth, pagination, retries | Credentials and CORS; that's a connector's job (CLI fetch is a convenience, not a client) |
| Running pipelines, syncing on a schedule | Emits a transform other tools run |
| Self-healing (auto-applying fixes) | Every change is approved by a person; that's the point |
| Two-way sync, writing back to the API | Read-side mapping only |
| Nesting deeper than one array level in v1 | `nested` (below) covers an order's line items; items-within-items waits for real demand |
| Joining records from different APIs | Join Receipt's job (optional handoff, §14) |
| An MCP server in v1 | No backend; P2 at most |
| Bundled Python | Single Node runtime (family convention) |

## 5. Personas

| Persona | Role here |
|---|---|
| **Leo, integration developer** (primary user) | Wiring a vendor API into his app's own types; has the docs, a test account and a target type |
| **Priya, Kaggle analyst** | Has nested API JSON, wants a flat table |
| **Dana, platform lead** | Wants vendor changes caught in CI |
| **Sam, hiring reader** (primary reader) | Gives the repo five minutes |

Leo as primary user is a departure from the family default (Priya). Joel's call, 2026-11-14: mapping an API into your own types is an integration developer's job, so the first screen, the samples and the fixture targets are built for him. Priya's flat-table case still works, because a column list is a target shape.

## 6. User stories

- As an integration developer, I want a proposed source for every target field with the evidence, so that I don't map by field name alone.
- As an integration developer, I want to be asked when two sources could fit, with real values under each, so that the ambiguous fields get my judgment and the obvious ones don't.
- As an integration developer, I want an order's line items mapped item by item into my target's `items[]`, so that I don't hand-write the inner mapping.
- As an integration developer, I want to see which fields fail the target's rules on some records, so that I handle nulls and odd values before they ship.
- As an integration developer, I want to be asked about units and epochs, with each reading shown, so that a timestamp in milliseconds doesn't become a date in 50,000 AD and cents don't become dollars.
- As an integration developer, I want a transform I can run without the tool, so that the tool isn't a runtime dependency.
- As a platform lead, I want a check that compares new samples against `fieldmap.yml` and fails CI on breakage, so that vendor changes don't reach a report.
- As a Kaggle analyst, I want nested JSON turned into a flat table with one row per array item when I choose, so that I don't write `json_normalize` paths by hand.
- *Edge:* as any user whose target field has no good source, I want to be told plainly, with the closest near-misses, so that I'm not handed a bad mapping.
- *Edge:* as any user with only a handful of samples, I want counts ("2 of 3"), not percentages, and fewer confident calls, so that three records don't look like proof.
- As a hiring reader, I want written decisions, tests and published accuracy, so that I can judge how it was built.

## 7. Requirements

**`fieldmap.yml`:** one entry per target field: target path and its context path (the parent array, if any), source path(s), transform chain, score with its parts, `proposed_by: rule | llm | user` (model id + prompt hash for `llm`), the answer to any question asked, and the sample set's hash. The file pins the tool version **and the exact `jsonata` version** (its 2.x point releases have changed the output of existing expressions), and records the target shape's hash.

**Fixture set:** 30–40 labelled mapping tasks (§10), built in v1. Labels are written before the engine runs on them. The sample responses are downloaded once, in a session Joel attends or by a script run once, and committed with their sources and licences; tests never touch the network.

### The closed grammar

Every mapping is described with these and nothing else; nothing else is ever turned into a transform. A model's answer is untrusted JSON until a validator accepts it. Each op has a JSONata emitter and a pandas emitter, each with tests; the semantics below are the spec both must meet.

| Op | Does | Semantics both emitters must meet |
|---|---|---|
| `path` | Source location, e.g. `order.customer.email` | Missing and `null` both read as missing (see canonical form) |
| `nested` | Map a source array of objects to a target array of objects, with a child mapping per item (one level deep in v1) | Output is always an array, including for one item and for none (`[]`); counts toward the op cap |
| `values` | A source array of scalars, e.g. `tags[*]` | Always an array, including for one item (the JSONata emitter adds `[]`, because JSONata otherwise returns a one-item sequence as the bare value) |
| `coalesce` | First non-missing of 2–3 paths | Missing and `null` are skipped alike |
| `concat` | Join 2–3 paths with a separator | A missing part is skipped with its separator, never rendered as empty text or NaN |
| `pick` | One item from an array: `first`, `last`, or where `key = value` | Two matches take the first (JSONata emitter appends `[0]`); no match is missing |
| `each` | One output row per array item | Only when the target is tabular (F17) |
| `count` | Number of items in an array | Missing array counts 0 |
| `trim`, `lower`, `upper` | As in Join Receipt | ASCII whitespace only for `trim`; `lower`/`upper` documented as locale-independent, with the known differences (Turkish dotted I) listed in the ADR |
| `cast` | To string, integer, number, boolean | **Guarded:** a value that won't convert becomes missing and is counted on the field's row, never thrown. (JSONata's `$number("abc")` throws and aborts the whole record, so its emitter checks with a regex first; pandas uses `to_numeric(errors="coerce")`) |
| `parse_date` | ISO 8601, epoch s, ms, µs or ns, or one of a fixed list of formats | Output is ISO 8601 in UTC. Each format in the list is kept as a tested JSONata/pandas pair |
| `scale` | Multiply by a power of ten | Cents → dollars. Never proposed from values alone (see F5) |
| `value_map` | Explicit table from source values to target values | Built-ins: Join Receipt's US state and country crosswalks; others recorded in `fieldmap.yml`; an unmapped value is missing and counted |
| `constant` | A fixed value | For target fields the source can't fill |

Max 5 ops per field. **Big integers:** an integer outside ±2^53 is read as a string and the field is flagged, because JavaScript (and so JSONata) loses precision above that while Python doesn't. Many APIs' `id` fields are that size; if the target wants a number for one, that's a question, not a silent cast.

**Canonical form, for comparing outputs.** Missing and `null` are the same; arrays are compared as arrays (never a bare value for a one-item array); integers compare exactly; non-integer numbers compare at 15 significant digits (JSONata's `$string` rounds to 15, Python prints 17); strings compare after Unicode NFC. Written into the grammar ADR.

### P0 (v1, web)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F1 | Load samples: JSON (one response or an array), NDJSON, pasted text | 1–50 files up to 50 MB total, or each failure names the file and reason; no network requests with AI off (e2e test, as in Join Receipt). Mapping and validation run in a worker |
| F2 | Load the target: JSON Schema (draft 2020-12 or 07, local `$ref` only), an example record, or a column list | A remote `$ref` is an error that names it, never a fetch. An inferred schema (from an example) is shown for confirmation, with one-click loosening: integer → number, nullable, optional |
| F3 | Profile every source path: type mix, missing/null share, distinct count, array depth, format class, and numeric shape (integer-like, epoch-like by magnitude) | Format classes reused from core: email, date, timestamp, currency, ISO2/ISO3, country name, ZIP, US state, FIPS, integer and text IDs. **New:** URL, UUID, and the JSON path profiler itself (`profileTable` is SQL over a table and can't do this; Join Receipt's P1 nested-JSON flattening, A14, will use the new code). Below 10 records, every share is shown as a count ("2 of 3") |
| F4 | Candidates per target field, scored on name similarity (path tokens plus a small synonym list), type compatibility, source-side evidence (format class, cardinality, missing share), and **rule fit** when the target has rules (share of sample values that pass the target's type, enum, format, pattern and range after the candidate's transforms) | 0–100, labelled "heuristic, not a probability", with each part shown. Accuracy reported separately for each target kind: JSON Schema, example record, column list (§10). With a column list there's no rule fit, and the score says so |
| F5 | Transforms proposed by rules | `cast` and `parse_date` from type and format evidence; `parse_date` only when the target is a date/date-time or the name says time, with every reading outside 1990–2040 flagged; `scale` **only** from a name (`_cents`, `_minor`, `amount_in_cents`) or the target's `multipleOf: 0.01`, otherwise a question with both readings shown; `coalesce` for "sometimes present" pairs only with ≥ 10 records; `concat` for split names. Each listed on the field's row with before/after samples |
| F6 | **Questions instead of guesses.** Asked when the top two candidates are within the gap G of each other, the top score is under T, a unit can't be told from values, or an epoch reading lands outside 1990–2040. Five real values under each option | G and T are fixed in this PRD before fixtures are scored: **T = 60, G = 10**. Changing them later is logged with the before/after numbers on the held-out set. No mapping under the threshold is pre-selected; answers recorded in `fieldmap.yml`; at most 1 question per target field |
| F7 | Validation: run the mapping over every sample and validate each output record against the target (ajv, the `Ajv2020` entry point for 2020-12, `ajv-formats` for `format`) | Per field and overall pass rates; failing records shown with the reason. Per-field rates come from per-field expressions; a test checks they agree with the full downloaded transform on every fixture |
| F8 | No good source | "Nothing in the samples fits `field`," with the top 3 near-misses and why each failed; option to set a constant or leave unmapped |
| F9 | Thin samples | Fewer than 3 distinct records, or a path's values all identical: say so, cap that field's score below T, and ask instead of proposing |
| F10 | Approve / edit / reject per field; edits recompute the row and the validation | Keyboard-only flow; screen-reader readable |
| F11 | Outputs: `fieldmap.yml`, `transform.jsonata`, a pandas snippet, and the mapped records (JSON, or CSV for a flat target) | **Determinism:** the same `fieldmap.yml` and version give byte-identical transform text. **Equivalence:** the pandas output equals the JSONata output in canonical form on every fixture (test, opt-in Python as in Join Receipt). Row-count equality alone isn't enough here |
| F13 | AI drafts (optional, off by default; user's key or a local OpenAI-compatible model) | Payload panel shows the exact request. Default payload: names, types and profiles; **categorical values pass through** when a path has ≤ 50 distinct values and isn't in the email class (the signal this job needs, like Join Receipt's public codes); high-cardinality strings and emails masked by shape. Answers only in the grammar, anything else rejected and shown as rejected; every proposal executed, validated and scored before display; model-proposed `value_map` entries marked "model-proposed, not checked against docs" and approved one by one |
| F14 | Sample datasets: real public API responses, at least one with line items (nested arrays) and one with an epoch and a units question | First recommendation in one click; source and licence recorded in the repo. Candidates: USGS earthquakes GeoJSON, NWS forecast, FEC, OpenAlex, Open Library (licences checked before use) |

**On screen, values are shown raw.** It's the user's own data in their own browser, the same as Join Receipt's receipt. A "hide values" toggle blurs them for screen-sharing. Masking applies to what goes to a model, not to what the user sees.

### P1

- F12 Optional OpenAPI 3.x spec for the source (`$ref`, `allOf` and components resolved locally): descriptions, types and enums used as evidence and shown as "the docs say"; a spec that disagrees with the samples is shown as a finding. Enables `value_map` from documented enums.
- F15 **Drift check** (v1.1, web and CLI): `field-map check fieldmap.yml new-samples/` reports per field: still resolves, path missing, type changed, pass rate dropped, new paths nobody maps. Below 10 new records it reports counts and only flags what's certain (a path missing from all of them). Proposes a fix for each broken field through the same question flow. Exit code 1 on breakage. Markdown output for PRs. This is the "dynamic API" half of the job, which is why it's v1.1 and not later.
- F16 CLI (`npx field-map`) with the same engine; `--url` fetch with headers from environment variables, never written to any file.
- F17 Target from a table: CSV header, or `CREATE TABLE` once Answerability Check's DDL parser has moved into core (its ADR 0004, not yet decided), with `each` for one row per item.
- F18 DuckDB SQL emitter (`read_json` + struct access), with the same equivalence test as pandas.
- F19 TypeScript and Python type definitions for the target, generated from `fieldmap.yml`.
- F20 Value matching for undocumented enums: suggested `value_map` entries from overlap and string similarity between source codes and target enum values, each scored by validation pass rate (bdi-kit's idea, in our grammar).

### P2

- F21 MCP tool exposing recommend and check, stats only, no sample values returned.
- F22 Multiple sources into one target (two endpoints filling one record), using Join Receipt's key detection for how they connect.
- F23 Learned rules: mappings people keep approving across projects (e.g. `amount_cents` → `scale -2`) become rules in config, as in Determinism Profiler's D10.

**Repo (P0):** README with paragraph, GIF, live demo, quick start and limits; ADRs (the grammar and its canonical form; `fieldmap.yml` as source of truth; questions instead of guesses with T and G frozen; JSONata as the engine; no live API calls in the browser); fixture accuracy regenerated by CI and shown in the README; green CI.

## 8. Architecture

- **Web:** Vite + React. **CLI:** Node. Both call `packages/core` and a new `packages/field-map` engine.
- **Reused from core, as it exists today:** `classifyColumn` (format classes), `maskValue` and the payload builder, the model providers, the US state and country crosswalks, `nameSimilarity`. **New, and shared back to core:** the JSON path profiler, the URL and UUID format classes.
- **Execution:** the grammar compiles to JSONata (`jsonata`, MIT, plain JS, version pinned exactly). JSONata runs the mapping for the screen and for validation, and the user downloads the same transform. Raw JSONata is never accepted from a user or a model in v1; the grammar is the only way in. `evaluate()` is async in JSONata 2.x, so the engine is async throughout and runs in a worker.
- **Validation:** ajv (MIT) against the target JSON Schema.
- **pandas** is generated as text from the grammar and tested against JSONata in canonical form.
- **No DuckDB in v1.** It returns with tabular targets (F17) and the SQL emitter (F18).
- **Convention change, named:** the family says "AI proposes, SQL decides" with DuckDB as the scratchpad. For nested JSON the engine that decides is JSONata, run locally. The family doc is reworded in the same PR: "AI proposes, a local engine decides (SQL or JSONata)."
- **AI layer** sits above `fieldmap.yml` and is frozen at approval; everything below it is deterministic for a given version.

## 9. Competitors

| Who | What they do | Our gap |
|---|---|---|
| superglue (superglue-ai) | Generated API configs and JSONata transforms to a target schema, validated against it, "self-healing" | Source-available (FSL), deprecated per its README, now a hosted product; heals without asking; no per-field evidence or questions |
| Workato, MuleSoft DataWeave, Boomi, Zapier/Make mappers | Visual field mapping, some AI suggestions | Paid, platform-locked, no evidence behind a suggestion, the transform lives in their runtime (not checked) |
| Airbyte, Fivetran, dlt | Move data and infer schemas | They land the source's shape; they don't map to yours |
| quicktype (Apache-2.0) | Types from sample JSON | Describes the source; no mapping to a target |
| bdi-kit, Valentine, magneto, PyDI | Schema and value matching research, Python, tables | Not a tool for JSON APIs; no transform, no drift check |
| aws-samples/sample-agentic-data-ingestion | Reference agent: questions with sample values when confidence < 0.7 | A sample on AWS services, not a tool; the question pattern is the idea we take |
| An LLM in a chat | Writes mapping code | No evidence, no validation, a different answer each time (Determinism Profiler's subject) |

## 10. Success metrics

**Fixture set.** 30–40 mapping tasks, each a set of real public API responses plus a target written before the engine runs. Families: clean renames; nesting changes; line items (`nested`); three-prices ambiguity; split and joined names; epoch s/ms/µs; cents vs dollars; enum codes; "sometimes present" fields; big-integer IDs; no good source; decoys built to beat the scorer (an `id` that looks right and isn't). Each task is run three times, once per target kind (JSON Schema, example record, column list), where the target allows. **Held-out:** 10 tasks scored only with T and G already frozen, from someone else's schemas where possible (the MaDI-Bench / automatic-data-integration pairs from wbsg-uni-mannheim, Apache-2.0 code, data licence to check).

**Denominator:** every labelled target field, including the ones whose right answer is "no good source" (counted right when the tool says so, wrong when it proposes something).

| Metric | Target | When |
|---|---|---|
| **Confident precision:** of fields presented confidently (no question, score ≥ T), the share that are right | ≥ 95%, per target kind | v1, each release |
| **Coverage:** share of labelled fields presented confidently | ≥ 60% with a JSON Schema target (other kinds reported, no target yet) | v1 |
| Questions per labelled field | Reported per target kind | v1 |
| Correct source ranked first, rules only | ≥ 85% with a JSON Schema target; others reported | v1 |
| Pandas output equals JSONata output in canonical form | 100% of fixtures (test) | v1 |
| Drift check: planted renames, type changes and removals caught | 100% on fixtures | v1.1 |
| Paste to first recommendation (sample data) | < 10 s | v1 |
| Cold read of the repo section passes | Pass | Before public |

Confident precision is the promise; coverage keeps it honest. A tool can hit 100% precision by asking about everything, and coverage is what catches that. Both are reported together, never one without the other, and the held-out numbers are reported as they come.

## 11. Open questions

| Question | Who | Blocking? |
|---|---|---|
| **Join Receipt's PRs (#1–#4, #6–#9) merged to main first.** The core library Field Map reuses exists only on that unmerged stack | Joel | **Yes, before the build starts** |
| Where it sits in the build order: before or after PrivacyDiff | Joel | Before build |
| Final name; trademark/domain check | Joel + joel-voice | Before launch page |
| Coverage targets for example-record and column-list targets, once there's a first run to look at | Joel | No |
| Licence of the MaDI-Bench data for the held-out set | Data | No (the held-out set can be built without it) |

Resolved: primary user is Leo, the integration developer (Joel, 2026-11-14). In review: JSONata isn't stable across its own minor versions, so the exact version is pinned in `fieldmap.yml`. Masking: raw values on screen with a hide toggle; categorical pass-through in the model payload.

## 12. Phasing

Sized by scope against Join Receipt v1, which took 11 plan tasks and about 34 hours of session time over 10 PRs. Field Map v1 is roughly 1.5× that.

| Phase | Ships | Plan tasks (rough) |
|---|---|---|
| v1 (web) | F1–F11, F13, F14, repo P0 | ~16: JSON profiler · target loaders (schema, example, columns) · grammar + validators · JSONata emitter · canonical form + pandas emitter + equivalence test · scorer · question flow · validation (ajv) · `fieldmap.yml` · fixture downloads (attended) · fixture labels · accuracy script · AI drafts · web UI · samples · e2e/a11y/repo |
| v1.1 | F15 drift check, F16 CLI, F12 OpenAPI | ~6 |
| v2 | F17–F20 | ~6 |
| Later | F21–F23 | — |

A written implementation plan (like `docs/plans/2026-11-09-join-receipt-v1-plan.md`) comes before any code.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Confident wrong mapping | Questions under T and G; confident precision is the headline metric, published with coverage |
| Too many questions, so people click through | Coverage and questions per field are metrics; questions only for close calls and unknowable units |
| Thresholds tuned until the metric looks good | T and G frozen in this PRD; a held-out set scored only with frozen values; changes logged with before/after |
| Three runtimes disagree on edge cases (nulls, one-item arrays, number printing, big integers) | Semantics written per op; canonical form; equivalence test on every fixture; big integers read as strings |
| Values shown on screen during screen-sharing | Hide-values toggle; nothing leaves the browser either way |
| Fixture set written by the same person as the scorer | Labels written first; held-out set scored with frozen thresholds; first-run scores reported as is, as Join Receipt does |
| Overlap with hosted tools makes it look redundant | The difference is evidence, questions and a transform you own; the README says so plainly |

## 14. Works with the others (optional)

- **Join Receipt:** mapped records exported as a flat table can be dropped into Join Receipt like any file. Shared core code for JSON path profiling.
- **PrivacyDiff:** if a `policy.yml` is present, target fields that carry personal data categories the notice doesn't list get a privacy line.
- **Answerability Check:** a tabular target's `CREATE TABLE` (F17) reads through its DDL parser once that parser is in core.
- **Determinism Profiler:** can profile the SQL export (F18) like any SQL folder; mappings people keep approving can come back as rules (F23).
