# Launch: what's ready and what waits on Joel

## Ready
- `vercel.json`: static deploy of `packages/join-receipt/dist`, built with `npm run build -w join-receipt`. Assets cached for a year (file names are hashed). No server code, no environment variables, no keys.
- The production build was checked headless: sample data in 1.0s, all three receipts right, the joined CSV is 216 rows, no request leaves the page's origin, no console errors.

## Waits on Joel, in this order
1. **Pick a look** (PR #5) and sign off the copy. Nothing public goes out before that.
2. **Merge the stack** (#1 → #2 → #3 → #4), then the look PR.
3. **Create the Vercel project and deploy.** That's the push to prod. Suggested home: `join-receipt.pettigrewlab.com`, or `/tools/join-receipt` behind a rewrite on the main site. Your call.
4. **Post it.** Drafts below. They name the problem and the number, and they don't oversell.

## Cost to know about
DuckDB-Wasm is about 8 MB gzipped per first visit (one of two 36 to 41 MB `.wasm` files, picked by browser). On Vercel that's bandwidth, not compute. A thousand first visits is about 8 GB.

## Page copy for pettigrewlab.com/tools (draft, for sign-off)

**Headline:** See what a join costs before you run it.

**Lede:** You join two files and the row count looks fine. It usually isn't. County codes lose their leading zero, a state shows up as "AL" in one file and "01" in the other, and a daily table quietly triples your totals. Join Receipt reads both files in your browser, finds the column that connects them, and tells you what matched, what didn't and why.

**The demo line:** On real Census and BLS files it found the right key six times out of six, and told us the 78 counties that wouldn't match were all Puerto Rico.

**What you take with you:** The SQL, the pandas code and a small file that records every decision, so the fix runs the same way next month.

**Privacy line:** Your files never leave your browser. There's no account and no upload.

**Button:** Try it with sample data

## Post drafts (not sent)

**Show HN: Join Receipt, see what a join costs before you run it**

I kept getting burned by joins that ran fine and were quietly wrong. FIPS codes missing their leading zero, state names against state codes, a daily table that tripled every sum. So I built a tool that profiles two files, finds the key, and writes a receipt: matched, dropped, what the dropped rows have in common, and whether anything gets counted twice.

It runs entirely in the browser on DuckDB-Wasm. On the sample data a plain `pd.merge` matches 177 of 216 counties without a word. Join Receipt finds the padding, gets 208, and says the 8 left over are all Alaska. On real Census and BLS files it picked the right key 6 of 6 times. The first run was 3 of 6, and the README says what I changed.

It exports SQL, pandas and a decision file. MIT licensed. Feedback on the scoring is very welcome.

**r/datasets or r/dataengineering, shorter:** Built a free, in-browser tool for the join that runs fine and is wrong. Drop two CSVs or Excel files and it tells you what matched, what dropped and why ("all 78 unmatched rows have State FIPS Code = 72"), and whether the join double counts. Nothing uploads. Exports SQL and pandas. Would love to hear where it gets the key wrong.
