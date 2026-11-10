import { describe, it, expect } from 'vitest';
import { buildPayload, draftFixes, findCandidates, buildReceipt, unmatchedExamples, type Plan } from '../src';
import { setup, csv } from './helpers';

// A real model call, off by default. Point it at a local OpenAI-compatible server:
//   JR_LIVE_MODEL=qwen3:30b-a3b-instruct-2507-q4_K_M npx vitest run packages/core/test/ai-live.test.ts
// JR_LIVE_ENDPOINT defaults to Ollama on this machine. Nothing here sends anything anywhere else.
const MODEL = process.env.JR_LIVE_MODEL ?? '';
const ENDPOINT = process.env.JR_LIVE_ENDPOINT ?? 'http://localhost:11434/v1';

describe.skipIf(!MODEL)('a live model', () => {
  it('proposes grammar-valid cleanups for unpadded county codes, and each one is scored before use', async () => {
    const counties = Array.from({ length: 30 }, (_, i) => 1001 + i * 2);
    const { db, profiles } = await setup({
      'counties.csv': csv('fips,name', counties.map((c, i) => [c, `County ${i}`])),
      'rates.csv': csv('county_fips,rate', counties.map((c, i) => [String(c).padStart(5, '0'), 3 + i / 10])),
    });
    const cand = (await findCandidates(db, profiles)).pairs[0].best[0];
    const plan: Plan = { join: { op: 'join_on', how: 'left', left: { ...cand.left, transforms: [] }, right: { ...cand.right, transforms: [] } } };
    const base = await buildReceipt(db, profiles, plan);
    expect(base.matchRateAfter).toBe(0);
    const payload = buildPayload(profiles, cand, base, await unmatchedExamples(db, profiles, plan), 'masked');
    const drafts = await draftFixes(db, profiles, cand, plan, base, payload, { kind: 'openai-compatible', endpoint: ENDPOINT, model: MODEL, apiKey: '' });
    expect(drafts.length).toBeGreaterThan(0);
    const best = Math.max(...drafts.map((d) => (d.ok ? d.receipt.matchRateAfter : 0)));
    console.log(drafts.map((d) => (d.ok ? `ok ${(d.receipt.matchRateAfter * 100).toFixed(0)}% ${d.why}` : `rejected: ${d.error}`)).join('\n'));
    expect(best).toBe(1);
  }, 180_000);
});
