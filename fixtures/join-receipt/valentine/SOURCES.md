# Valentine accuracy set: sources and licences

Nothing in this folder is data. `npm run accuracy:valentine` downloads the files at run time into a cache outside git
(`~/.cache/data-tools/valentine`, or `$VALENTINE_CACHE`). This file says where they come from and on what terms, checked on 2026-11-14.

| What we use | Where it comes from | Licence | How we use it |
|---|---|---|---|
| The Valentine benchmark zip (`Valentine-datasets.zip`, 602 MB) | Koutras et al., "Valentine: Evaluating Matching Techniques for Dataset Discovery", ICDE 2021. Zenodo, DOI [10.5281/zenodo.5084605](https://doi.org/10.5281/zenodo.5084605) | CC BY 4.0 (the Zenodo record) | Downloaded at run time, never committed. Only the `Joinable` folders are read. |
| `ChEMBL/Joinable` (48 pairs, the `assays` table) | ChEMBL, EMBL-EBI | CC BY-SA 3.0 (ChEMBL's own licence, which travels with the data) | Read at run time. Nothing derived from the rows is committed: labels.json holds column names and file paths only, and accuracy-valentine.json holds counts and column names. |
| `OpenData/Joinable` (48 pairs, the `miller2` table) | Canadian government open data, by way of the Valentine authors | Open Government Licence – Canada, per the source portal. The zip doesn't restate it, and I didn't check it file by file. | Same as above. |
| `TPC-DI/Joinable` (48 pairs, the `prospect` table) | Generated with the TPC-DI data generator (DIGen), redistributed in the Valentine zip | The TPC's EULA covers the generator. The generated rows ship in the CC BY 4.0 Zenodo record. | Same as above. Not redistributed by us. |
| 10 NYC Open Data pairs | `delftdata/valentine`, `experiments/data/<pair>/` (`source_table.csv`, `target_table.csv`, `ground_truth.json`), pinned to commit `f6f8019` | Repository: Apache-2.0. Rows: NYC Open Data, free to use under the NYC Open Data terms of use. | Fetched at run time from raw.githubusercontent.com at that commit. |

Not used: Magellan and Wikidata (no Joinable pairs), and the Unionable, View-Unionable and Semantically-Joinable folders.

## How the pairs were made, and why that matters

Valentine makes each Joinable pair by splitting one table in two: some rows go to both halves, and the halves share one or more columns. The `ac1` to `ac5` variants rename the target columns (`assay_id` becomes `assays_assay_id`), and `ec` keeps the names. So every pair has a perfect, exact-value key by construction: no lost leading zeros, no state codes on one side and names on the other. That makes it **easier than a real join**, and its score is a separate number from the 20-pair real set.

## Labels

`label.ts` turns the ground truth ("source column A equals target column B", one line per shared column) into an expected join key, and it ran before the engine saw any of these files. The rule: the key is the matched pair whose source column identifies a row (no blanks, all values different), and any one of them counts if several qualify. If none qualifies, any matched pair counts. That happens for every OpenData pair (no column of `miller2` is unique) and 6 of the 10 NYC pairs, so those labels are lenient.
