# Real-data checks

Analyses written the way people write them, run against real public data instead of planted fixtures. Each folder gets a `data` link at run time; nothing here is committed data.

| Case | Data | What it shows |
|---|---|---|
| `chinook` | Chinook sample database (CSV) | `string_agg(DISTINCT ...)` with no ORDER BY gives a different genre list each run |
| `taxi` | NYC taxi trips, 2.96M rows (Parquet) | an unseeded `USING SAMPLE 1%`; three runs in about 1.5 s |
| `movielens` | MovieLens small (ratings, movies) | `list(set(...))` and an unseeded `.sample()` as origins; the train/test split, model and MAE inherited; an unseeded random forest under "also check" |
| `pagila` (static only) | Pagila Postgres schema dump | three real unordered `array_agg`/`group_concat` views, no noise from DDL |

```bash
DP_REAL_DATA=/path/to/heldout/data npm run accuracy:real
```

`DP_REAL_DATA` defaults to the answerability-check repo's `heldout/data` folder on Joel's machine (Chinook CSVs, Pagila, and the `.download` folder with the taxi Parquet and the MovieLens zip). Cases whose data isn't there are skipped and say so.
