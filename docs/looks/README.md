# Report look options (for Joel to pick)

Three restyles of the same real report (the MovieLens notebook in `fixtures/determinism-profiler/real`). Same words, same structure; only the look changes. Each adds a run strip per step: one mark per run, showing whether that run matched run 1.

| | Look | Idea | Screens |
|---|---|---|---|
| A | Lab notebook | Graph paper and ink, runs as ticked or crossed boxes like a lab log | `a-lab-notebook-1280.png`, `a-lab-notebook-390.png` |
| B | Seismograph | Each step is a line; a run that moved jumps off it | `b-seismograph-1280.png`, `b-seismograph-390.png` |
| C | Pull request | Sits next to a code review: red, yellow and green rows, runs numbered 1 2 3 | `c-pull-request-1280.png`, `c-pull-request-390.png` |

The shipped `report.html` stays the plain default until one is picked. Rebuild with `npx tsx docs/looks/build-looks.mts <dir with report.json and traces>`.
