# Join Receipt

Before you join two tables, see what the join costs. Join Receipt profiles your files, finds the columns that connect them, and writes a receipt for each join: how many rows matched, how many dropped and what the dropped rows have in common, and whether anything would be counted twice. You approve it, and you take the fix with you as SQL, pandas and a `mapping.yml` that records every decision. It runs in your browser. Your files don't leave it.

Here's the problem it's for. A county code is `1001` in one file and `01001` in the other. The join still runs. On the sample data in this repo, a plain `pd.merge` quietly matches 177 of 216 counties and says nothing. Join Receipt finds the zero-padding, gets it to 208, and tells you the 8 left over are all Alaska, because Alaska isn't in the unemployment file at all.

## Run it

```bash
npm install
npm run dev          # http://localhost:3067, click "Try the sample data"
npm test             # 48 tests against real DuckDB
npm run accuracy     # scores the labelled join set, writes fixtures/join-receipt/accuracy.json
```

To check the AI path against a real model on your own machine (Ollama by default, nothing leaves it): `JR_LIVE_MODEL=<ollama model> npx vitest run packages/core/test/ai-live.test.ts`.

To also run the generated pandas code inside the tests, point `JR_PYTHON` at a Python that has pandas: `JR_PYTHON=/path/to/python npm test`.

## What's in a receipt

- **Matched and didn't match**, as row counts on each side, with the match rate before and after any cleanup.
- **What the unmatched rows have in common.** For each column with 3 to 50 distinct values, it compares how often a value shows up among the unmatched rows with how often it shows up overall (lift). Anything at 3× or more with at least 3 rows gets a sentence: "All 8 unmatched rows have state = AK (AK is 4% of the file)." It states the pattern, never a cause.
- **Fan-out.** If the right side has more than one row per key, the join multiplies rows and your sums go wrong. It says by how much (measured against matched rows, so drops can't hide it) and offers to roll that side up first, with a sum or first-value choice per column.
- **Cleanup with before and after rows.** Padding, case, trimming, state and country name/code lookups, date rounding.
- **A score from 0 to 100,** labelled as a heuristic, not a probability, with the reason in one line.

## How it's built

- `packages/core` is the engine. It's plain TypeScript, never imports DuckDB, and talks to a three-method `Db` interface. Every number on screen comes from a SQL query it builds.
- `packages/core-node` runs the core on `@duckdb/node-api` for tests, fixtures and a future CLI.
- `packages/join-receipt` is the web app: Vite, React and DuckDB-Wasm in a worker. CSV, JSON and Parquet readers are built into the Wasm bundle and extension auto-install is turned off, so the page never downloads DuckDB code from the internet. Loading CSV, Excel, JSON, NDJSON and Parquet files made no request outside localhost.
- A join is described with a small closed grammar (`trim`, `lower`, `upper`, `lpad`, `crosswalk`, `cast`, `date_trunc`, `join_on`, `aggregate`). Rules, people and models all use the same grammar, and the same SQL builder produces both the receipt queries and the SQL you download, so the numbers you see come from the expressions you take home.
- Keys are always compared as text. DuckDB will otherwise cast `'01001'` to the number 1001 and "match" codes that pandas won't, which makes the receipt and the exported code disagree. That one came from the design review.

Decision records are in [docs/adr](docs/adr). The design, the plan and the review that changed it are in [docs/specs](docs/specs), [docs/plans](docs/plans) and [docs/reviews](docs/reviews).

## AI drafts (optional, off by default)

If you turn it on, a model can suggest cleanups the rules missed. You bring your own key (Anthropic) or point it at a local model (anything OpenAI-compatible, including Ollama). Before anything is sent you see the exact request, and by default sample values are masked (`01001` goes out as `99999`; public state and country codes stay as they are). The model can only answer in the grammar above. Anything else is rejected and shown as rejected. Every valid suggestion is run and scored on your data before you see it, and if you keep one, `mapping.yml` records the model and a hash of the prompt.

Checked against a real model: qwen3 30B on a local Ollama, in the app and in `ai-live.test.ts`. On 30 unpadded county codes it sent back three fixes. One took the match rate from 0% to 100%, and the other two did nothing (0%). The scoring is what tells them apart, which is the point. The Anthropic path is covered by request-shape tests but hasn't been run against the live API yet.

On localhost, Ollama answers the page as is. From a deployed copy it only answers pages it trusts, so start it with `OLLAMA_ORIGINS=<that page's origin> ollama serve`.

## Accuracy

`npm run accuracy` runs the engine on 41 labelled file pairs in 8 families: clean joins, unpadded FIPS codes, case and whitespace drift, name vs code lookups, decoys built to beat the scorer (row-number IDs on both sides, a shared state column, overlapping ID ranges), grain mismatches, planted drops, and pairs with no real key.

Current result: **41 of 41** (36 of 36 keyed pairs ranked first, 5 of 5 "no reliable join" correctly called). Two seeds the scorer was never tuned on also score 41 of 41.

Read that number for what it is. The first run scored 94.4%, and the two misses led to classifier fixes. The set is synthetic, and the same person wrote the generator and the scorer. It shows the engine does what it's designed to do. It doesn't prove it works on your data yet. Real public datasets (Census, BLS) are the next thing to add to the set.

## Limits right now

- CSV, TSV, Excel (.xlsx), Parquet and JSON/NDJSON. Excel files are read from the first sheet with a table in it, skipping title rows above the header and footnotes below the data. The exported scripts read a CSV copy of that table (you download it with them), because reading the .xlsx directly in DuckDB or pandas turns years into `2024.0` and dates into serial numbers, and the keys would stop matching. The old .xls format isn't supported.
- Keys can be up to three columns, like state × county or county × year. It proposes a second column when the best single one repeats on both sides, and you can add one under "Change it". Cleanup steps apply to the first key column only.
- Joins are pairwise. Planning across many tables comes later.
- The SQL export is DuckDB SQL (it uses `TRY_CAST` and `read_csv_auto`). Postgres is planned with the dbt output.
- The sample data is synthetic, shaped like Census county files.

## License

MIT
