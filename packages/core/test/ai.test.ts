import { describe, it, expect } from 'vitest';
import { maskValue, buildPayload, buildRequest, redact, extractJson, draftFixes, findCandidates, buildReceipt, unmatchedExamples, promptHash, type Plan, type Fetcher } from '../src';
import { setup, csv } from './helpers';


async function scene() {
  const { db, profiles } = await setup({
    'a.csv': csv('code,name', [['A-001', 'Ann Lee'], ['A-002', 'Bo Chu'], ['A-003', 'Cy Diaz'], ['A-004', 'Di Fox']]),
    'b.csv': csv('code,v', [['a-001 ', 1], ['a-002 ', 2], ['a-003 ', 3], ['a-004 ', 4]]),
  });
  const cand = (await findCandidates(db, profiles)).pairs[0].best[0];
  const plan: Plan = { join: { op: 'join_on', how: 'left', left: { ...cand.left, transforms: [] }, right: { ...cand.right, transforms: [] } } };
  const base = await buildReceipt(db, profiles, plan);
  return { db, profiles, cand, plan, base };
}

describe('AI layer', () => {
  it('masks shape but keeps public codes', () => {
    expect(maskValue('Ann-01')).toBe('Aaa-99');
    expect(maskValue('AK')).toBe('AK');
    expect(maskValue('France')).toBe('France');
    expect(maskValue('ann@x.com')).toBe('aaa@a.aaa');
  });

  it('masked payloads carry no raw sample values; raw mode is explicit', async () => {
    const { db, profiles, cand, plan, base } = await scene();
    const un = await unmatchedExamples(db, profiles, plan);
    expect(un.left.length).toBeGreaterThan(0);
    const masked = JSON.stringify(buildPayload(profiles, cand, base, un, 'masked'));
    for (const v of ['A-001', 'a-002', 'Ann Lee']) expect(masked).not.toContain(v);
    expect(masked).toContain('A-999');
    const raw = JSON.stringify(buildPayload(profiles, cand, base, un, 'raw'));
    expect(raw).toContain('A-00');
  });

  it('builds provider requests with the required fields and redacts keys for display', async () => {
    const { profiles, cand, base } = await scene();
    const p = buildPayload(profiles, cand, base, { left: [], right: [] }, 'masked');
    const a = buildRequest({ kind: 'anthropic', endpoint: 'https://api.anthropic.com/', model: 'm', apiKey: 'sk-secret' }, p);
    expect(a.url).toBe('https://api.anthropic.com/v1/messages');
    expect((a.body as { max_tokens: number }).max_tokens).toBe(1024);
    expect(a.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(JSON.stringify(redact(a.headers))).not.toContain('sk-secret');
    const o = buildRequest({ kind: 'openai-compatible', endpoint: 'http://localhost:11434/v1', model: 'llama', apiKey: '' }, p);
    expect(o.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(o.headers.authorization).toBeUndefined();
    expect(await promptHash()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('extracts JSON from chatty replies', () => {
    expect(extractJson('Sure! {"proposals":[{"why":"a } in text"}]} done')).toEqual({ proposals: [{ why: 'a } in text' }] });
  });

  it('runs and scores valid drafts, and rejects anything outside the grammar', async () => {
    const { db, profiles, cand, plan, base } = await scene();
    expect(base.matchRateAfter).toBe(0);
    const reply = {
      proposals: [
        { left: [{ op: 'sql', text: 'DROP TABLE a' }], right: [], why: 'evil' },
        { left: [{ op: 'lower' }], right: [{ op: 'trim' }, { op: 'lower' }], why: 'case and spaces differ' },
      ],
    };
    const fake: Fetcher = async () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }] }), { status: 200 });
    const payload = buildPayload(profiles, cand, base, { left: [], right: [] }, 'masked');
    const drafts = await draftFixes(db, profiles, cand, plan, base, payload, { kind: 'anthropic', endpoint: 'x', model: 'm', apiKey: 'k' }, fake);
    expect(drafts[0]).toMatchObject({ ok: true, delta: 1 });
    expect(drafts[1]).toMatchObject({ ok: false });
    expect(drafts[1].ok === false && drafts[1].error).toContain('"sql" is not an allowed operation');
  });

  it('reports provider errors with status, never the key', async () => {
    const { db, profiles, cand, plan, base } = await scene();
    const fake: Fetcher = async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 });
    const payload = buildPayload(profiles, cand, base, { left: [], right: [] }, 'masked');
    await expect(draftFixes(db, profiles, cand, plan, base, payload, { kind: 'anthropic', endpoint: 'x', model: 'm', apiKey: 'sk-secret' }, fake))
      .rejects.toThrow(/401.*invalid x-api-key/);
  });
});
