# PrivacyDiff: PRD

**Date:** 2026-11-09 · **Owner:** Joel · **Status:** draft
**One job:** check whether your data does what your privacy notice says.
**Stands alone:** needs a privacy notice plus data in any form it can read (files, table definitions, SQL, a dbt project). It does its own classification and combination checks with the shared core library; it doesn't need Join Receipt. Family overview: `2026-11-09-data-tools-family.md`.
**Signature tool:** this is where Joel's privacy law training and data work meet. The curated rule set is authored by Joel.
**Legal stance (Joel, 2026-11-08):** cites the rule, never a verdict.
**Home:** pettigrewlab.com/tools/privacydiff · `npx privacydiff` · GitHub Action

## 1. PR/FAQ

Customer quotes are **illustrative**; numbers and findings in examples are mock-ups; launch copy gets its own `joel-voice` pass.

**Headline:** Does your data do what your privacy notice says?

**Intro.** PrivacyDiff reads your privacy notice and checks your data against it. Paste the notice (or import a Fides or DPV file, or tick the categories you disclose) and it drafts a structured `policy.yml` for you to confirm. Then point it at your data: files, table definitions, a folder of SQL, or a dbt project. It tells you which personal information your data holds that the notice doesn't mention, which combinations privacy law treats as sensitive, and where one row stands out on its own. Each finding quotes the sentence in your notice and the rule it relates to. It doesn't give a verdict. That's still your call.

**The problem.** Privacy notices and data pipelines are written by different people and drift apart. The notice says what the company collects and why. The pipeline quietly adds a precise location field, joins it to email, and ships it to a dashboard. Nobody checks one against the other until an audit or a complaint. Existing tools either need someone to annotate every field by hand, or only look at application code, not the tables and joins where data gets combined.

**The solution.** Put the notice next to the data. PrivacyDiff classifies columns into personal-information categories, maps them to what the notice discloses, and reports findings in four plain classes: disclosed, disclosed only vaguely, not disclosed, or contradicted. A short, curated rule set covers combinations that need extra care, like health data with identifiers or data about children. A uniqueness check shows when a set of columns narrows to a single row. In a pull request, the same checks run on what changed and follow data through the SQL.

> "Data teams and privacy teams mostly meet after something has gone wrong. I've sat on both sides of that. This puts the privacy notice in the room when the data gets shaped, while the person doing it can still do something about it."
> **Joel Pettigrew**

**What the user experiences.**
1. Pastes their privacy notice. PrivacyDiff drafts `policy.yml` (categories collected, purposes, sensitive categories) and highlights the sentence behind each line. They confirm or fix it.
2. Drops in files or pastes table definitions. Each column gets a proposed category; they confirm the ones it isn't sure about.
3. Sees findings by table. Example (mock-up): *`events.lat` and `events.lon` look like precise geolocation. Your notice lists "approximate location" only (paragraph 3). Precise geolocation is sensitive personal information under CPRA.*
4. Picks tables to combine and sees what the combination brings together: sensitive-combination flags and whether any set of columns narrows to one person in this dataset.
5. Clicks a finding for the rule and the usual options: generalise, aggregate, drop the field, restrict it, or update the notice. Hashing is offered only for direct identifiers and labelled as still personal data.
6. (CLI / Action) Runs `npx privacydiff` on a SQL folder or dbt project, or adds the Action, and gets the same findings on every pull request with file and line.

**What it enables.**

| Who | With PrivacyDiff |
|---|---|
| Privacy officer (Owen) | Sees where the data and the notice disagree, in plain words, without reading SQL |
| Analytics engineer (Marcus) | Finds out about a mismatch from a PR comment, not a legal review |
| Kaggle analyst (Priya) | Notices before publishing that a joined dataset narrows people down to one row |
| Someone hiring Joel (Sam) | Privacy law and data engineering working in the same tool |

> *Illustrative customer quote:* "Our notice said approximate location. PrivacyDiff showed a table with GPS coordinates. Better to find that ourselves."
> **Privacy officer**

**FAQ**
- **Is this legal advice?** No. It compares your data to your own notice and cites the rule a finding relates to. Whether you're meeting the law is a decision for you and your privacy counsel.
- **Does my data leave my computer?** No, unless you connect an AI model to draft `policy.yml` from your notice. Then the panel shows what's sent (the notice text, not your data).
- **Do I have to upload data?** No. Table definitions or SQL are enough for category findings. Uniqueness needs data.
- **Which laws?** CPRA categories and sensitive personal information, GDPR special categories, and the HIPAA identifiers to start. The rule set is open and cites its sources.
- **What about Fides?** PrivacyDiff reads and writes a Fides-compatible taxonomy, so it can feed an existing Fides setup.

## 2. Problem

Privacy notices and data pipelines drift apart, and nothing compares them at the point where data is collected, combined or shipped. Existing privacy-as-code tools need manual field annotation (Fides) or scan application code only (Privado, HoundDog, Bearer). Research has checked apps against their policies (PoliCheck, PurPliance), but not warehouse data.

## 3. Goals

1. Every column classified, and every undisclosed or contradicted category found, with the notice sentence quoted.
2. Precision first: "not disclosed" findings are right at least 9 times in 10.
3. Works without data (DDL, SQL) for category checks; with data for uniqueness.
4. Never phrased as a legal verdict.
5. For Joel: the clearest demonstration of law plus data engineering.

## 4. Non-goals

| Non-goal | Why |
|---|---|
| Compliance verdicts or certification | Cites the rule, never a verdict |
| Application-code scanning | Privado and others cover it |
| Consent management, DSARs, cookie banners | Different products |
| Training on customer notices or data | Nothing leaves the machine |

## 5. Personas

**Owen, privacy officer** (primary for this tool) · **Marcus, analytics engineer** · **Priya, Kaggle analyst** · **Dana, platform lead** (CI) · **Sam, hiring reader**.

## 6. User stories

- As a privacy officer, I want to paste our notice and confirm a structured version of it, so that checks run against what we promised.
- As a privacy officer, I want each finding to quote the notice sentence and name the rule, so that I can review without reading SQL.
- As a privacy officer, I want findings sorted into disclosed, vague, not disclosed and contradicted, so that I know which ones need action.
- As an analytics engineer, I want a PR comment when my change brings in a category the notice doesn't list, so that I fix it before merge.
- As a Kaggle analyst, I want to know if combining two files narrows people down to one row, so that I don't publish something that exposes someone.
- As a platform lead, I want the check to run from table definitions and SQL alone, so that no data leaves our environment.
- *Edge:* as a privacy officer with a vague notice ("we may collect identifiers"), I want vague matches flagged as vague, not passed as disclosed, so that the notice gets fixed too.

## 7. Requirements

**P0 (v1, web)**

| ID | Requirement | Acceptance criteria |
|---|---|---|
| C1 | Classify columns into a fideslang-compatible personal-information taxonomy with a crosswalk to CPRA §1798.140, GDPR Art. 9 and the HIPAA identifiers | Direct identifiers ≥ 90% recall on a 200-column labelled fixture (built in v1); quasi-identifiers proposed, then confirmed by the user |
| C2 | `policy.yml` from the notice: paste text (AI drafts if connected), import Fides / DPV, or tick CPRA categories | Every line links to its notice sentence; nothing is checked until the user confirms |
| C3 | Inputs: files, pasted DDL; (CLI) SQL folders and dbt projects | DDL-only gives category findings with no data loaded |
| C4 | Collection check: categories present vs `policy.yml`, in four classes (disclosed, vague, not disclosed, contradicted) | Precision ≥ 0.9 on "not disclosed" on a fixture corpus (public notices + synthetic data with planted findings); each finding quotes the notice sentence |
| C5 | Sensitive-combination rules: curated YAML authored by Joel (special categories, CPRA sensitive PI, HIPAA identifiers with health data, under-13 data) | Each rule cites its source; deterministic, no model |
| C6 | Combination check: user picks tables and the key that links them (key suggested by the core library); reports what the combination brings together | Works on any two or more tables without Join Receipt |
| C7 | Uniqueness signal: share of entities unique on the confirmed quasi-identifiers, on full data, per entity | Labelled "unique in this dataset"; matches a reference on the fixture |
| C8 | Options per finding: generalise, aggregate, suppress, drop, restrict, update the notice; hashing only for direct identifiers, labelled "pseudonymises, still personal data" | After a chosen option, the finding recomputes |
| C9 | Wording rule | UI never says "compliant", "violates", "identifiable" or "re-identified"; enforced by a test over all strings |
| C10 | AI off by default; payload panel | Only the notice text is ever sent, and only when the user connects a model |

**P1 (v1.1, CLI + Action)**
- C11 `npx privacydiff` on SQL folders and dbt projects (compiled via `manifest.json`): category propagation through SQL lineage; dbt `meta.purpose` / exposures for purpose checks, else a collection-only check.
- C12 GitHub Action, static mode: PR comment with findings (file and line) on changed models; fails on a "not disclosed" category reaching an exposure, or a sensitive combination without a recorded option. Data mode (uniqueness) only when the team configures warehouse access.

**P1 (v2)**
- C13 Tracking-plan check (Segment / RudderStack schemas) against `policy.yml`.
- C14 Purpose-limitation checks using PoliCheck/PurPliance-style flow-to-policy consistency.

**P2**
- C15 Population-uniqueness estimates (Rocher et al. 2019 style). C16 l-diversity / t-closeness. C17 Policy export to OPA/Rego for enterprises that want it.

**Repo (P0):** README, GIF, live demo with a sample notice and data; ADRs (wording rule, fideslang-compatible taxonomy, no-verdict stance, static vs data mode); the rule set as a readable, cited YAML file; fixture precision in CI.

## 8. Architecture

Web (Vite + React + DuckDB-Wasm), CLI and Action (Node) on the shared core library (profiling, PI classification, key suggestion). SQL lineage uses DuckDB's parser for DuckDB/Postgres-style SQL and a JS parser for other dialects; coverage checked before C11, with a Wasm sqlglot port as the fallback inside Node. The rule engine is plain TypeScript over YAML rules; no OPA needed at this size.

## 9. Competitors

| Who | What they do | Our gap |
|---|---|---|
| Ethyca Fides | Privacy as code; policy evaluation in CI with manual annotation | Notice → `policy.yml`, automatic classification, joins and lineage |
| Privado, HoundDog.ai, Bearer (Cycode) | App-code data-flow scanning | Warehouse data and SQL, checked against the notice |
| Altimate (PII in PRs, status unverified), Datafold (PII lineage) | PII detection and lineage | No notice comparison |
| Google Cloud DLP, ARX, sdcMicro | Re-identification risk analysis | Heavy or cloud-bound; not tied to a notice |
| PoliCheck, PurPliance (research) | App flows vs privacy policy | Not applied to warehouse data |

Watch: Privado's 2025 AI agents for privacy assessments. Search demand (Tier 1): gdpr compliance software 1,900/mo ($15–51), data classification tool 390 ($17–76), privacy impact assessment automation 260 ($17–60), pii detection 110, privacy engineering 210.

## 10. Success metrics

| Metric | Target | When |
|---|---|---|
| Precision on "not disclosed" (fixture corpus) | ≥ 0.9 | v1, each release |
| Direct-identifier recall | ≥ 90% | v1 |
| Wording test passes | 100% | Every build |
| Cold read of the repo section passes | Pass | Before public |
| Privacy or data people who mention it to Joel | 3 | 6 months |

## 11. Open questions

| Question | Who | Blocking? |
|---|---|---|
| Exact wording for citations and the options text | Joel | v1 |
| First rule set: which rules, which sources | Joel | v1 |
| Public notices to use in the fixture corpus (licence to include text) | Joel / legal | v1 |
| Do the JS SQL parsers cover real dbt SQL? | Engineering | v1.1 |
| Will teams give the Action warehouse access? (static mode works without) | Market | No |

## 12. Phasing

| Phase | Ships | Size |
|---|---|---|
| v1 (web) | C1–C10, repo P0 | 5–6 weeks |
| v1.1 (CLI + Action) | C11–C12 | 3–4 weeks |
| v2 | C13–C14 | 4 weeks |
| Later | C15–C17 | — |

## 13. Risks

| Risk | Mitigation |
|---|---|
| A wrong "not disclosed" finding in front of a privacy officer | Precision-first acceptance; notice sentence quoted; user confirms `policy.yml` first |
| Reads as legal advice | Wording rule enforced by test; FAQ |
| Notice parsing errors | AI only drafts; the user confirms every line |
| SQL parser coverage | Checked before v1.1; fallback inside Node |

## 14. Works with the others (optional)

- **Join Receipt:** if this tool's `policy.yml` is present, each Join Receipt shows a privacy line.
- **Answerability Check:** can note when answering a question needs categories the notice doesn't list.
- PrivacyDiff never needs either.
