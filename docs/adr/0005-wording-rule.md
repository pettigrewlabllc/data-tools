# 5. Wording rule

Date: 2026-11-14 · Status: accepted

**Decision.** PrivacyDiff never says "compliant", "compliance", "violates", "violation", "identifiable", "re-identified", "illegal" or "lawful". A vitest test (`packages/core/test/privacy-wording.test.ts`) scans every source file in the privacy module and the web app, including rules.yml, the message and copy files, and comments, and fails on any of them. The Playwright sample flow checks the rendered page too.

**Why.** The tool compares data to the user's own notice and cites the rule a finding relates to. Those words are verdicts, and a verdict is the user's and their counsel's call.

**Cost.** Statute titles that contain one of the words can't be quoted verbatim. Cite the section number instead.
