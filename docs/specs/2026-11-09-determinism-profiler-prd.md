# Determinism Profiler: PRD

**Date:** 2026-11-09 · **Owner:** Joel · **Status:** draft (working name)

**One job:** run an analysis several times and show which steps give the same answer, and why the others don't.

**Stands alone:** needs a notebook, a folder of SQL, or a dbt project. Nothing from the other tools. Family overview: `2026-11-09-data-tools-family.md`.

**Origin:** Joel's idea (source brief, message 6): analyse a measured workflow, break it into components, push it toward deterministic analysis, supervised first and reinforced later. Joel confirmed the scope is any data analysis workflow, not only joins.

**Home:** `npx determinism-profiler` · a report viewer and the published study on pettigrewlab.com/tools/determinism-profiler

## 1. PR/FAQ

Customer quotes are illustrative; launch copy gets its own joel-voice pass.

**Headline:** Run your analysis three times. See which steps give the same answer, and why the others don't.

**Intro.** The Determinism Profiler runs a notebook, a folder of SQL, or a dbt project several times and compares each step's output. Steps that always match are marked deterministic. Steps that change are flagged with the likely cause: a LIMIT without an ORDER BY, a random sample with no seed, a timestamp, a tie in a ranking, or an AI step. It's one command, and nothing about your data leaves your machine.

**The problem.** A lot of data analysis gives slightly different answers each time it runs, and nobody notices until two people compare numbers. AI-assisted analysis makes it worse: ask an agent the same question twice and you may get two different methods. Teams can't trust what they can't repeat, and they can't fix it if they can't see which step is moving.

**The solution.** Measure it, step by step. The profiler hashes each step's output, never the contents, and only blames a step when its inputs were identical across runs, so it points at the right place. A static check reads the SQL and code for the usual causes before anything runs. Where a step is a judgment call with a few possible answers (which key, which aggregation, which null rule), the tool learns from the choices people approve and turns them into a rule, so that step stops moving.

> "Making AI data work trustworthy mostly means making it boring. The same input should give the same answer, and you should be able to see where it still doesn't." Joel Pettigrew

**What the user experiences.**

1. Runs `npx determinism-profiler my-notebook.ipynb --runs 3` (or a SQL folder, or a dbt project).
2. Gets a report: each step, whether it matched across runs, what changed (rows, values, order), and the likely cause.
3. Reads the static findings with file and line, and fixes the obvious ones first.
4. Reruns and watches the score move.
5. (v2) Points it at an AI agent's trace and sees the same per-step report for the agent's tool calls.

**What it enables.**

| Who | With the profiler |
|---|---|
| Kaggle analyst (Priya) | Finds out her result depends on an unseeded sample before she publishes |
| Analytics engineer (Marcus) | Finds the model that returns different rows each run |
| Platform lead (Dana) | A consistency report per model she can attach to a PR |
| Someone hiring Joel (Sam) | A published study of how consistent public data agents are, with the code to rerun it |

> Illustrative customer quote: "The profiler found the one cell that changed my top-ten list every run. It was a sort with ties." Kaggle analyst

**FAQ**

- *Does it need Python?* It runs your notebook with your own Jupyter, which you already have if you use notebooks. The profiler itself is a Node tool.
- *Does my data leave my machine?* No. It stores hashes of each step's output, never the contents.
- *What counts as a step?* A notebook cell, a SQL file or statement, a dbt model, or (v2) an agent's tool call.
- *Can it make my analysis deterministic for me?* It shows you which steps move and why. For judgment steps with a few possible answers, it can turn the choices you approve into rules.
- *Is there a study?* Yes (v2): public data agents run several times on a public data-analysis benchmark, with per-step results and all the code.

## 2. Problem

Much data analysis isn't repeatable: unordered limits, unseeded sampling, ties, timestamps, and now AI steps. Nobody measures it per step, so nobody knows which step to fix. Agent evaluation tools measure agents' final answers, not the determinism of each step in a data workflow.

## 3. Goals

- A per-step report for a notebook, SQL folder or dbt project in one command.
- Correct blame: the step that introduces variance, not the ones downstream of it.
- Static causes found with file and line before any run.
- Judgment steps that keep getting the same approved answer become rules.
- For Joel: a published, rerunnable study that people can cite.

## 4. Non-goals

| Non-goal | Why |
|---|---|
| Fixing code automatically | Reports and proposes; the user changes code |
| Training or fine-tuning hosted LLMs | Only rules and small local models we own |
| Business process mining | Joel's scope is data analysis workflows |
| Storing data contents | Hashes only |

## 5. Personas

Priya, Kaggle analyst (primary user) · Marcus, analytics engineer · Dana, platform lead · Sam, hiring reader (the study is for him).

## 6. User stories

- As a Kaggle analyst, I want to run my notebook three times and see which cells change, so that my result is reproducible.
- As an analytics engineer, I want to find the dbt model that returns different rows each run, so that I can fix it.
- As any user, I want the likely cause with file and line, so that I can fix it without guessing.
- As any user, I want the tool to blame the step that started the variance, not everything after it, so that I fix the right thing.
- As a platform lead, I want a Markdown report for a PR, so that reviewers see consistency next to the change.
- As a hiring reader, I want a published study with code, so that I can see the author's method and results.
- Edge: as a user whose notebook takes 20 minutes, I want to profile a subset of cells, so that three runs are practical.

## 7. Requirements

**P0 (v1)**

| ID | Requirement | Acceptance criteria |
|---|---|---|
| D1 | Trace format: step_id, kind, parent, input_hashes, output_hash, params, duration; hashes only | Documented schema; a trace never contains data values (test) |
| D2 | Inputs: Jupyter notebook (run with the user's own `jupyter nbconvert --execute`; compare cell outputs and saved frames), SQL folder (run in DuckDB), dbt project (manifest.json + run_results.json + output hashes) | Each input profiled on a fixture project; a clear message when jupyter or dbt isn't installed |
| D3 | Run N times (default 3); per-step verdict (same / differs: rows, values, order) | A planted non-deterministic step is flagged on every fixture; a deterministic fixture scores 100% |
| D4 | Attribution: blame a step only when its inputs were identical across runs | On a fixture with an upstream now(), the upstream step is blamed |
| D5 | Static causes: now()/random()/unseeded sampling, LIMIT without ORDER BY, ties in ORDER BY/ROW_NUMBER, set-order dependence, float aggregation order; AI steps marked as judgment | Each cause has a fixture and is reported with file and line |
| D6 | Report: terminal and Markdown; a static HTML viewer | Same content in all three |
| D7 | Subset runs (`--cells`, `--select` for dbt) | Profiles only the chosen steps and their inputs |

**P1 (v2)**

- D8 Agent traces: OpenTelemetry GenAI spans and Langfuse / LangSmith exports (conventions still experimental; supported versions pinned).
- D9 Published study: run 2–3 public data agents N times on a public data-analysis benchmark (InfiAgent-DABench or DABstep, licence permitting); report per-step variance; publish traces and code.
- D10 Learned decisions: for discrete judgment steps, learn from approved choices locally and distil them into rules in config; evaluated on held-out real cases, not synthetic ones.

**P2**

- D11 Reward-based tuning on verifiable outcomes (tests pass, totals reconcile) for routing or prompt policies or small local models we own. Research; labelled as such.

**Repo (P0):** README with a GIF of a report, quick start on a sample notebook, ADRs (hash-only traces, attribution rule, no bundled Python), fixtures for every static cause, CI.

## 8. Architecture

Node CLI. Notebooks run through the user's Jupyter; SQL through `@duckdb/node-api`; dbt through the user's dbt and its artifacts. Static checks use DuckDB's SQL parser plus a JS parser for other dialects, and simple pattern checks for Python cells (random, sample without random_state, datetime.now). Output hashing: row count plus an ordered content checksum, with an order-insensitive checksum alongside so "same rows, different order" is reported as an order difference.

## 9. Competitors

| Who | What they do | Our gap |
|---|---|---|
| Agent eval tools (LangSmith, Langfuse, Braintrust) | Trace and evaluate agent runs | Per-step determinism of data workflows, notebooks and dbt |
| dbt tests, data-quality tools | Check values against expectations | Run-to-run consistency and its cause |
| One 2026 study of tool-calling pipelines (unverified beyond abstract) | Measures agent consistency | Not data analysis; no tool |

No published run-to-run consistency results were found for data-agent benchmarks (Fable review, 2026-11-08).

## 10. Success metrics

| Metric | Target | When |
|---|---|---|
| Planted causes detected on fixtures | 100% | v1, each release |
| Correct attribution on fixtures | 100% | v1 |
| Study published with code | 1 | v2 |
| Outside citations or reruns of the study | 1 | 12 months |
| Cold read of the repo section passes | Pass | Before public |

## 11. Open questions

| Question | Who | Blocking? |
|---|---|---|
| Final name | Joel + joel-voice | Before launch |
| Benchmark licence for a republished study | Legal | v2 |
| Which agents to include in the study | Joel | v2 |
| How to hash notebook outputs that are images or widgets | Engineering | v1 (skip with a note if needed) |

## 12. Phasing

| Phase | Ships | Size |
|---|---|---|
| v1 (CLI) | D1–D7, repo P0 | 3–4 weeks |
| v2 | D8–D10, study | 5–6 weeks |
| Later | D11 | — |

## 13. Risks

| Risk | Mitigation |
|---|---|
| Blames the wrong step | Attribution rule with fixtures |
| Long notebooks make N runs impractical | Subset runs |
| Agent trace formats change | Pin supported versions |
| Study reads as cherry-picked | Publish all runs and code; preregister the method in the repo |

## 14. Works with the others (optional)

- Join Receipt: the SQL it generates can be profiled like any SQL folder; key choices people keep approving can come back as rules (the first learned decision).
- The profiler never needs another tool.
