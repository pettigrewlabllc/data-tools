# Field Map ADR 0002: `fieldmap.yml` is the source of truth

**Status:** accepted, 2026-11-14

The decision is kept in `fieldmap.yml`: one entry per target field with its mapping in the grammar, score and parts, `proposed_by` (rule, user or llm), and the answer to any question asked. The transform is generated from it, never edited directly. The same file and versions give byte-identical transform text (tested).

The file pins the tool version and the **exact** `jsonata` version. JSONata's 2.x point releases have changed what existing expressions return, so a file made with another version is refused with the reason rather than quietly producing different output. The sample set's hash and the target's hash are recorded so the drift check (v1.1) can tell what it's comparing against.
