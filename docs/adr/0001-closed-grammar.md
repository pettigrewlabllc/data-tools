# 1. AI proposes from a closed grammar; SQL decides

Date: 2026-11-09 · Status: accepted

**Decision.** Models never write SQL or code. They return JSON that must parse into the same small set of operations the rules and the user use (`trim`, `lower`, `upper`, `lpad`, `crosswalk`, `cast`, `date_trunc`, `join_on`, `aggregate`), checked by a hand-written validator that rejects unknown operations, extra fields, out-of-range values and unknown columns. Every accepted proposal is run through the same receipt engine before anyone sees it.

**Why.** A confident wrong join is the main risk of this tool. A closed grammar makes model output auditable, makes injection impossible by construction, and lets one SQL builder serve rules, people and models alike.

**Cost.** Some fixes a model could express in SQL (regex extraction, fuzzy matching) are out of reach until they are added to the grammar on purpose.
