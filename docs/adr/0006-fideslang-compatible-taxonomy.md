# 6. Fideslang-compatible taxonomy

Date: 2026-11-14 · Status: accepted

**Decision.** Categories use fideslang's `user.*` id shape (`user.contact.email`, `user.location.precise`) so `policy.yml` can be exchanged with a Fides setup, and each carries a crosswalk to CPRA Cal. Civ. Code §1798.140(v)(1) and (ae), GDPR Art. 9(1), the 18 HIPAA Safe Harbor identifiers in 45 CFR §164.514(b)(2)(i)(A)-(R), and COPPA 16 CFR §312.2. Categories PrivacyDiff added that fideslang may not list are marked `extra: true`.

**Why.** Fides is the nearest existing tool; speaking its ids costs little. The crosswalk is what lets a finding cite a rule.

**Cost and open item.** The ids were written from memory of fideslang, not checked against a current release. Verify before claiming exact compatibility. Subsections are cited only as far as they are known: CPRA categories at §1798.140(v)(1) without letters, sensitive personal information at paragraph level.
