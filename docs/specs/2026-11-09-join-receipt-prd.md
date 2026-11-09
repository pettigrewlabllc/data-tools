# Join Receipt: PRD

**Date:** 2026-11-09 · **Owner:** Joel · **Status:** draft
**One job:** before you join two tables, see what the join costs, and get a drafted fix.
**Stands alone:** needs only two or more files or tables. Family overview and shared conventions: `2026-11-09-data-tools-family.md`.
**Home:** pettigrewlab.com/tools/join-receipt · `npx join-receipt`

## 1. PR/FAQ

Customer quotes are **illustrative** (never published as testimonials); numbers in example receipts are mock-ups. Launch copy gets its own `joel-voice` pass.

**Headline:** Join Receipt tells you why your rows went missing, and drafts the fix.

*Free, in your browser, no account. The answer comes out as code you can keep.*

**Intro.** Join Receipt profiles every column you give it, finds the keys that connect your files, and writes a plain-English receipt for each join: how many rows matched, how many dropped and what they have in common, and whether anything would be counted twice. If you connect an AI model, it drafts the cleanup (padding codes, matching names to codes, rolling daily data up to yearly) and shows every row before and after. It runs in your browser. You don't need dbt or a database.

**The problem.** Joining data is mostly guessing. A county code is `1001` in one file and `01001` in the other. One file is daily, the other yearly. The join still runs. It just drops or doubles rows quietly, and you find out three cells later, or never. Tools like Power Query and Tableau Prep will tell you how many rows matched. They won't tell you what the missing rows have in common, and they don't hand you the fix as something you can keep.

**The solution.** Join Receipt does the checking a careful senior analyst would do and writes it down. It tries the obvious cleanups and lists each one. When rows don't match, it finds the column that best explains them. When a join would multiply rows, it says by how much and offers to roll one side up first. The AI can propose cleanups, but it can only choose from a fixed list of operations, and nothing it proposes reaches you until it has been run and scored like everything else. Every decision lands in `mapping.yml`, with a note saying whether a person, a rule or a model wrote it.

> "Every data project I've worked on has a moment where two tables get joined and nobody checks what that cost. Usually it's fine. Sometimes it's the reason the number in the board deck is wrong. I wanted that moment to come with a receipt."
> **Joel Pettigrew, Pettigrew Lab**

**What the user experiences.**
1. Opens /tools/join-receipt and clicks the sample datasets, or drops in their own files. With no AI connected, nothing leaves the browser.
2. Sees each file's columns and what they look like (county code, date, email, free text), and what one row stands for in each file.
3. Gets the proposed joins, ranked, each with its receipt. Example (mock-up): *3,108 matched after zero-padding. 34 didn't match, and all 34 have state = AK. Joining the daily file would triple the rows; roll it up to the year first.*
4. Optionally pastes their own API key or points at a local model. A panel shows exactly what would be sent. The model drafts cleanups; each one appears with its own before and after rows and its effect on the match rate.
5. Approves, rejects or edits each join. The receipt recalculates on every change.
6. Downloads the joined data, the SQL, a Python snippet for their notebook, and `mapping.yml`. A dbt user can get a dbt folder from the same file.

**What it enables.**

| Who | Before | With Join Receipt |
|---|---|---|
| Kaggle analyst (Priya) | Trial and error with `merge()` and a write-up that hopes the numbers are right | A join she can defend, with the caveats written down and code for her notebook |
| Analytics engineer (Marcus) | A day of digging for each new source | A reviewed join and dbt models in one sitting |
| Someone hiring Joel (Sam) | A resume line that says "data architecture" | A working tool, a clean repo and a decision file that shows how he thinks |

> *Illustrative customer quote:* "I'd been staring at a county dataset for an hour wondering why Alaska was blank. The receipt pointed at it in one line."
> **Kaggle analyst**

**Getting started.** Free at pettigrewlab.com/tools/join-receipt, with sample datasets so there's nothing to prepare. `npx join-receipt` for anyone who wants it on their own machine.

**FAQ**
- **Does my data leave my computer?** Not unless you connect an AI model. If you do, a panel shows exactly what gets sent first, and by default that's column statistics and a few masked sample values.
- **Do I need dbt or a database?** No. You get the joined data, SQL, a Python snippet and `mapping.yml`. dbt is optional.
- **Does it use AI?** Only if you turn it on. The AI drafts cleanups from a fixed list of operations. It can't write SQL directly and it never produces a number: every number comes from SQL run on your machine.
- **How good is it at finding the right join?** Accuracy on a labelled test set of real and deliberately broken joins is published and updated every release.
- **Isn't this what Power Query or Tableau Prep does?** They show how many rows matched. This shows what the unmatched rows have in common, catches double counting, drafts the fix, and gives you the decision as a file you keep.
- **What does it cost?** Free and open source.

## 2. Problem

People who combine datasets guess how they join, and the guess fails quietly: rows drop because codes are formatted differently, rows double because grains differ. Today's tools either assume the join is known (dbt), show counts without reasons (Power Query, Tableau Prep, Alteryx), or alert after the fact (data-quality tools). Cost: wrong numbers in write-ups and decks, and hours lost to "where did my rows go".

## 3. Goals

1. From "two files" to a reviewed join, with the pattern behind dropped rows named, in under 5 minutes.
2. No silent double counting: every fan-out is caught before the join is approved.
3. The decision is kept: `mapping.yml` regenerates the same SQL and Python for a given tool version.
4. AI help that can't make things up: drafts are limited to a closed grammar and checked before display.
5. For Joel: a repo a hiring reader understands and trusts in five minutes.

## 4. Non-goals

| Non-goal | Why |
|---|---|
| Running pipelines or scheduling | Emits code other tools run |
| Answering business questions or privacy checks | Separate tools (Answerability Check, PrivacyDiff) |
| Join planning across many tables (v1) | P2 |
| Bundled Python, Splink | Single Node runtime; fuzzy matching via DuckDB built-ins |
| A chat interface | AI fills a closed grammar only |

## 5. Personas

| Persona | Role here |
|---|---|
| **Priya, Kaggle analyst** (primary user) | 2–5 CSVs, no docs, Python notebooks, no dbt |
| **Sam, hiring manager** (primary reader) | Opens the repo; gives it five minutes |
| **Marcus, analytics engineer** | Wants dbt models from the same decisions |
| **Dana, platform lead** (v2) | Runs it against warehouse tables; data can't leave |

## 6. User stories

- As a Kaggle analyst, I want to drop in files and see which columns join them, so that I don't guess keys.
- As a Kaggle analyst, I want to see what my unmatched rows have in common, so that I can fix it or say so in my write-up.
- As a Kaggle analyst, I want a warning when a join will duplicate rows, so that my averages aren't silently wrong.
- As a Kaggle analyst, I want the AI to draft the cleanup and show rows before and after, so that I can trust it without writing it myself.
- As a Kaggle analyst, I want a Python snippet that reproduces the join, so that I keep working in my notebook.
- As a Kaggle analyst, I want sample datasets, so that I can see what it does in one click.
- *Edge:* as a Kaggle analyst whose files share no key, I want to be told plainly, with the closest near-misses, so that I'm not handed a bad join.
- As a hiring manager, I want a README with a GIF and a live demo, so that I understand it in under a minute.
- As a senior engineer, I want written architecture decisions, tests and published accuracy, so that I can judge how it was built.
- As an analytics engineer, I want dbt models and tests from `mapping.yml`, so that I commit it like any other change.
- As a platform lead, I want profiling to run inside our warehouse and return only statistics, so that no rows leave.

## 7. Requirements

**`mapping.yml`:** every entry records `proposed_by: rule | llm | user` (and model id + prompt hash for `llm`); the file pins the tool version. **Fixture set:** 30–50 labelled join pairs (real public joins plus seed-fixed broken copies), built in v1.

**P0 (v1)**

| ID | Requirement | Acceptance criteria |
|---|---|---|
| A1 | Load CSV, Parquet, JSON/NDJSON, Excel in the browser | 2–10 files up to 200 MB total load, or each failure names the file and reason; with no AI connected, the network log shows no data requests. Excel via DuckDB-Wasm if the extension loads, else SheetJS → Arrow |
| A2 | Profile columns: type, distinct, null %, uniqueness, format class (FIPS, ISO country, ZIP, email, date, currency, free text), table grain | Distinct/null/uniqueness match a pandas reference; format class ≥ 95% on labelled fixture columns; large files profiled on a labelled sample; joins and uniqueness on full data |
| A3 | Candidate joins: key uniqueness, containment both ways, name similarity, format match | Correct join first on ≥ 90% of the fixture set; no shared key → "no reliable join" + top 3 near-misses |
| A4 | Normalise before matching: padding, case, trim, code↔name crosswalks (country, US state), date/timestamp | Each normalisation listed on the receipt; crosswalks ship with the app and cite their source |
| A5 | Explain unmatched rows by lift | Report 1–2 columns with lift ≥ 3 (unmatched share ÷ overall share), excluding columns with < 3 distinct values; state the pattern, not a cause |
| A6 | Grain mismatch and fan-out | Show the multiplication factor; propose an aggregation with per-column choice (default sum for numeric measures, first for dimensions), editable inline |
| A7 | Heuristic score and reason per join | 0–100, labelled "heuristic, not a probability", one-line reason citing its numbers |
| A8 | Approve / reject / edit | Writes `mapping.yml`; edits recompute the receipt |
| A9 | Output: joined data (CSV/Parquet), SQL, Python (pandas or DuckDB) snippet, `mapping.yml` | Same `mapping.yml` + version → byte-identical SQL and Python; Python reproduces the joined row count on the fixture set |
| A10 | Sample datasets (federal public domain: Census, USDA, CDC PLACES, BLS LAUS) | First receipt in one click; licences recorded in the repo |
| A17 | AI-drafted mappings (optional, off by default; user's key or Ollama) | Closed grammar (`lpad`, `lower`, `trim`, `crosswalk:<table>`, `date_trunc`, `cast`, `join_on`, `aggregate`); out-of-grammar rejected; every proposal executed and scored before display; AI + heuristics top-1 ≥ heuristics alone on the fixture set |
| A18 | Before/after diff per normalisation | N sample rows raw vs transformed, plus the match-rate change |
| A19 | Payload panel | Exact payload shown before any model call; default stats + masked samples; raw samples is an explicit toggle |
| A22 | Accessibility | Receipt readable by screen reader; keyboard-only approve/reject |

**P1**
- A11 Shareable receipt (stats only).
- A12 dbt output (v1.1): `sources.yml`, staging and joined models, `schema.yml` tests; `dbt build` passes on dbt-duckdb and dbt-postgres with zero edits; no engine-specific macros.
- A13 Kaggle metadata (`dataset-metadata.json`, column descriptions) to name entities.
- A14 Nested JSON flattening.
- A20 Units normalisation.
- A21 Follow an existing dbt project's naming.
- A23 CLI (`npx join-receipt`) with the same engine; Postgres adapter, then Snowflake, BigQuery, Databricks, SQL Server; push-down mode returns stats only.

**P2**
- A15 Join planning across many tables. A16 Fuzzy key matching (DuckDB `jaro_winkler_similarity` / `levenshtein` with blocking) and a Splink settings export.

**Repo (P0):** README with paragraph, GIF, live demo, quick start and limits; ADRs (closed grammar, `mapping.yml` as source of truth, single Node runtime, no backend); fixture accuracy regenerated by CI and shown in the README; green CI badge; MIT or Apache-2.0.

## 8. Architecture

- **Web:** Vite + React + DuckDB-Wasm. **CLI:** Node + `@duckdb/node-api`. Both call the shared core library (profiling, key detection, SQL/Python emitters, `mapping.yml`).
- **SQL emit:** a small typed TypeScript AST emitting only portable SQL; no sqlglot, no Pyodide (too heavy for the < 20 s first-receipt target).
- **Python emit:** generated as text; no Python runtime needed.
- **AI layer:** sits above `mapping.yml` and is frozen at approval; everything below is deterministic for a given version.

## 9. Competitors

| Who | What they do | Our gap |
|---|---|---|
| Power Query, Tableau Prep, Alteryx Designer Cloud | Propose keys, show match counts and mismatched values | Why rows dropped, fan-out, closed-grammar AI drafts, a decision file, free in-browser |
| pandas `merge(validate=, indicator=)` | Code-level checks | No explanation, no drafting |
| Datafold | Data diff after a change | We explain before the join |
| Aurum, Auctus, Valentine, OmniMatch, LakeBench | Join discovery research | Research systems, not an analyst's tool |

## 10. Success metrics

| Metric | Target | When |
|---|---|---|
| Cold read of the repo page passes (what, who, why it's well built) | Pass | Before public |
| Correct join ranked first on the fixture set | ≥ 90% | v1, each release |
| Page load to first receipt (sample data) | < 20 s | v1 |
| Visitors who see a first receipt / load their own files | 40% / 15% | 30 days |
| Interviews where the repo came up | 3 | 6 months |

## 11. Open questions

| Question | Who | Blocking? |
|---|---|---|
| Final name; trademark/domain check | Joel + joel-voice | Before launch page |
| Which federal sample datasets give good receipts (drops, grain mismatch) | Data | v1 |
| Does the DuckDB Excel extension load in Wasm? | Engineering | No (SheetJS fallback) |

## 12. Phasing

| Phase | Ships | Size |
|---|---|---|
| v1 (web) | A1–A10, A17–A19, A22, repo P0 | 5–6 weeks |
| v1.1 (CLI + dbt) | A12, A23 (files + Postgres) | 3 weeks |
| v2 | A11, A13, A14, A20, A21, more adapters | 4 weeks |
| Later | A15, A16 | — |

## 13. Risks

| Risk | Mitigation |
|---|---|
| Confident wrong join or AI draft | Drafts executed and scored before display; closed grammar; accuracy published |
| Privacy promise broken by AI calls | Off by default; payload panel; masked samples |
| Browser memory on large files | Labelled sampling for profiling; CLI for big data |
| Repo reads as a weekend project | Repo requirements are P0 |

## 14. Works with the others (optional)

- **PrivacyDiff:** if a `policy.yml` is present, each receipt shows a privacy line (categories the join brings in that the notice doesn't list). Without it, no privacy section.
- **Answerability Check:** can read this tool's `mapping.yml` to reuse approved joins.
- **Determinism Profiler:** can profile the SQL this tool generates, like any SQL folder; key choices people keep approving can come back as rules.
