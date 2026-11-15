# 8. Static (DDL) mode and data mode

Date: 2026-11-14 · Status: accepted

**Decision.** Column names and types alone give the category findings and the combination check (static mode). Values, when loaded, sharpen the classifier (email, card with Luhn, SSN, IP, coordinate precision, birth dates) and are the only way to measure uniqueness (data mode). Uniqueness runs in DuckDB on the full file and is labelled "unique in this dataset".

**Why.** Many teams can share table definitions but not data. Static mode must work on its own, and data mode must never be needed for a category finding.

**Cost.** Names-only recall is lower on opaque column names; the accuracy file reports both modes.
