# Field Map ADR 0003: questions instead of guesses, with T and G frozen

**Status:** accepted, 2026-11-14

A field gets a question instead of a proposal when the best score is under **T = 60**, when the runner-up is within **G = 10** points, when cents or dollars can't be told from the values, when an epoch reading lands before 1990 or after 2040, when a big integer would be cast to a number, or when the samples are too thin to say (fewer than 3 distinct records, or every value the same). Nothing under the bar is pre-selected. Under 35 the tool says nothing fits and lists the closest three with why each fails.

T and G were set in the PRD before any fixture was scored and haven't moved. Changing them later means logging the before and after numbers.

**One deviation from the PRD, on purpose.** The PRD let `scale` be proposed from a target's `multipleOf: 0.01`. A target written in dollars says nothing about whether the source is in cents, so that case asks instead. `scale` is proposed only from the source's name (`_cents`, `_minor`).

**What the fixture numbers mean.** The first run is kept in `fixtures/accuracy-first-run.json`. The scorer was then fixed on the same set (generic fixes: localized leaves like `category.en`, unit suffixes like `_cents`, a "first name" rule that matched `first_file_date`, names contained in longer names). `fixtures/accuracy.json` is after those fixes, so it's no longer a clean test of unseen data. A held-out set scored only with frozen thresholds is still to be built.
