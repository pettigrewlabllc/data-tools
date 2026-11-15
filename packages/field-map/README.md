# Field Map

Paste a few responses from an API and the shape you need. Field Map says where each field should come from, shows the evidence, and asks you when it isn't sure. You approve it and take home a JSONata transform, the same mapping in Python, and a `fieldmap.yml` that records every decision. It runs in your browser. Your data doesn't leave it.

Here's the problem it's for. An order payload has `list_price`, `sale_price` and `unit_price`. Your type has `price`. Most tools pick one by name and say nothing. On the sample data here, Field Map scores all three within 10 points of each other, so it asks which one you mean and shows real values under each. It doesn't guess on cents either: `amount: 1999` could be $19.99 or $1,999, and the values can't tell you, so it asks.

## Run it

```bash
cd packages/field-map
npm install
npm run dev          # http://localhost:3089, then "Try the vendor orders"
npm test             # engine, emitters, every fixture
npm run accuracy     # scores the labelled tasks, writes fixtures/accuracy.json
npm run e2e          # browser tests against the production build (port 3090)
```

To also check the Python output against the JSONata output on every fixture, point `FM_PYTHON` at a Python that has pandas: `FM_PYTHON=/path/to/python npm test`. CI does.

## How it decides

For each target field it scores every source path out of 100 on four parts, and shows each one:

- **Name**: tokens, a short synonym list, and containment (`price` in `sale_price`). A leaf like `category.en` or `x.value` is read as its parent.
- **Type**: whether the values fit the target's type, after any cast it proposes.
- **Evidence**: what the values look like (email, URL, UUID, date, epoch time, ID) against what the field needs, weighted by how often the path is present.
- **Rules**: the share of mapped sample values that pass the target's own type, format, enum, pattern and range checks, with the same ajv the final validation uses.

It's a heuristic, not a probability, and the page says so. Under **60**, or within **10** points of the runner-up, it asks instead of picking. Both numbers were fixed before any fixture was scored. Under 35 it says nothing fits and lists the closest three with why each one fails. It also asks about cents vs dollars, epoch readings outside 1990 to 2040, 20-digit IDs that a number would round, and samples too thin to confirm anything.

Every candidate, including a model's draft and your own edit, is compiled to JSONata and run on your samples before it's scored or shown.

## Accuracy

17 labelled tasks, 95 target fields, each run three ways: with a JSON Schema target, an example record, and a list of column names. Five of the sample sets are real public API responses (USGS earthquakes, the Nobel Prize API, OpenAlex, the National Weather Service, the FEC); four are synthetic vendor payloads for cases real APIs don't show cleanly (three prices, cents, fields that come and go, IDs past 2^53). Sources and licences are in `fixtures/samples/SOURCES.json`.

| Target | Confident precision | Coverage | Questions per field | Right source ranked first |
|---|---|---|---|---|
| JSON Schema | 100% (72 of 72) | 75.8% | 0.24 | 95.8% |
| Example record | 100% (71 of 71) | 74.7% | 0.25 | 94.7% |
| Column names | 100% (70 of 70) | 73.7% | 0.24 | 90.5% |

Read those with two caveats. The first run, before any fixes, was 95.8% / 74.7% for JSON Schema targets (three confident wrong answers), and it's kept in `fixtures/accuracy-first-run.json`. The scorer was then fixed on the same set, so the table above isn't a test on unseen data. A held-out set, scored only with the thresholds frozen, is still to be built. Confident precision is the promise and coverage keeps it honest: a tool can be 100% precise by asking about everything.

## What's in the grammar

`path`, `coalesce`, `concat`, `pick`, `values`, `count`, `constant` and `nested` (an order's line items, one level deep) for the source; `trim`, `lower`, `upper`, `cast`, `parse_date`, `scale` and `value_map` as transforms. At most five ops per field. Nothing else becomes a transform: a model's answer is untrusted JSON until the validator accepts it. The exact semantics both emitters meet (nulls, one-item arrays, number printing, big integers, dates without an offset) are in `docs/adr/field-map-0001-grammar-and-canonical-form.md`.

## The optional model

Off by default. Use your own key or a local model through an OpenAI-compatible endpoint (Ollama's is the default). The payload panel shows the exact request before anything is sent: names, types and profiles, with values masked by shape unless a path has 50 or fewer distinct values and isn't an email. Answers have to be in the grammar and name real paths, and they're scored like any other candidate. A model-proposed value table is marked as unchecked.

## Limits

- One level of nesting. Items inside items wait for real demand.
- No drift check, CLI or OpenAPI input yet (v1.1).
- No `each` (one row per array item) for tabular targets yet.
- Built standalone for now. A few helpers (the state and country crosswalks, the model provider) are copied from Join Receipt's core library in `src/shared/`, each with the commit it came from, until that library is on `main`.

Decisions are in `docs/adr/field-map-*.md`. The PRD, its review and the build plan are in `docs/specs`, `docs/reviews` and `docs/plans`.
