# 2. mapping.yml is the source of truth

Date: 2026-11-09 · Status: accepted

**Decision.** Every approved or rejected join is written to `mapping.yml` with who proposed it (`rule`, `user` or `llm`, plus model and prompt hash), the receipt's counts and the tool version. SQL and pandas are generated from that file alone, and the same file and version produce byte-identical output (tested).

**Why.** The decision is the product. Code can be regenerated; the reasoning behind "join on padded FIPS and roll the daily file up first" can't, unless it's written down.

**Cost.** Output depends on the tool version, so the file pins it.
