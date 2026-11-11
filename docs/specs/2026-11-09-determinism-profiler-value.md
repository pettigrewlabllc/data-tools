# Determinism Profiler: value statements

**Date:** 2026-11-09 · **Status:** evaluated by Fable 2026-11-09 (review: `../reviews/2026-11-09-determinism-profiler-value-review.md`); wording below is the post-review version · **PRD:** `2026-11-09-determinism-profiler-prd.md`

Shape Joel asked for: *As a ___, this will matter to me because I can use it to ___, where it wasn't possible before / where it was hard before.* Each one names what it replaces, so the "before" can be checked.

## v1 (what gets built now)

**V1. Priya, Kaggle analyst.** As a Kaggle analyst, this will matter to me because I can run my notebook three times with one command and be told which cell's output moved, before I publish. Before, it was hard: nbval and nbdime tell me every cell whose output differs; nothing tells me the first one, and the cell that causes it (`df = df.sample(100)`) usually prints nothing at all.

**V2. Marcus, analytics engineer.** As an analytics engineer, this will matter to me because I can point it at my dbt project and get the one model that returns different rows between builds, blamed on the model that starts it rather than every model downstream. Before, it was hard: Recce and audit_helper diff two *environments*; dbt's own idempotency advice is "run it twice and compare row counts" by hand. Nothing diffs two builds of the same code and blames the origin, or tells me the sources moved instead.

**V3. Any user, the cause.** As anyone who writes SQL or pandas, this will matter to me because I can get the likely cause with file and line (LIMIT without ORDER BY, an unseeded sample, `now()`, a tie in ROW_NUMBER) before I run anything. Before, linters caught one of these (sqlfluff AM09: LIMIT without ORDER BY). Nothing caught ties, unseeded samples, timestamps or aggregation-order drift, and nothing tied a static warning to a difference actually seen between runs.

**V4. Any user, how much it matters.** As anyone comparing two runs, this will matter to me because I can tell "same rows, different order" from "different rows" from "different values," so I know whether to care. Before, it was hard: a plain diff or hash just says *changed*, and order-only changes look as alarming as wrong numbers.

**V5. Dana, platform lead.** As a platform lead, this will matter to me because I can attach a per-step consistency report (Markdown) to a PR, so reviewers see whether a change made a model repeatable or not. Before, Recce and Datafold could post an environment-vs-environment diff to a PR, and dbt tests check values against expectations; there was no run-to-run consistency artifact.

**V6. Anyone with private data (convenience, not a headline).** I can share the trace and report in a public issue, since they hold hashes and counts, never values or source text. Before, it was awkward rather than impossible (DVC lock files share hashes per stage; row counts can be pasted by hand).

## v2 and later (not built now, listed so the v1 design doesn't block them)

**V7. Sam, hiring reader (v2 study).** I can read a rerunnable study of how consistent public data agents are, step by step. Before, it wasn't possible: no published run-to-run results exist for data-agent benchmarks.

**V8. Anyone using AI in analysis (v2 traces).** I can see which tool call in an agent's run moved, using the same report. Before, it was hard: agent eval tools score the final answer.

**V9. Judgment steps (v2 learned decisions).** A step with a few possible answers that people keep approving the same way becomes a rule and stops moving. Before, it wasn't possible without hand-writing the rule.

## What v1 has to get right for these to be true

- V1 and V2 only hold if **attribution** is right (D4). If it blames downstream steps, it's no better than a diff.
- V3 only holds if the **static checks** are precise enough that people read them (low false-positive rate on deterministic fixtures).
- V4 needs **two checksums per output** (ordered and order-insensitive) plus a row count.
- V6 needs a **test that a trace never contains a data value.**
- V2's "before" is weakest if dbt users already have a tool for this. Fable: check.

## After Fable's review

Verdict: proceed, with one blocker fixed in the design. Changes carried into the v1 design spec:

1. **Notebook attribution uses instrumented state, not output diffs** (blocker). An injected cell after each user cell hashes the variables that cell assigned or read; a cell's inputs are the hashes of the names it reads plus the files it opens.
2. **dbt:** `--full-refresh` on every run; sources and seeds hashed every run, and a moved source makes downstream verdicts "inconclusive", never blame; v1 hashes dbt-duckdb only and says so for other adapters.
3. **Ties are candidates.** A static tie warning is shown as confirmed only when that step showed an order-only or value difference in a run; otherwise it's a low-key "could vary, didn't in N runs".
4. **Traces carry no source text.** Code is stored as a hash; findings carry file, line and the matched keyword only.
5. `--select` passes dbt selectors through, so `state:modified+` works for Dana.
6. The HTML viewer stays (it's a P0 requirement and it's a render of the same report model), kept small.
