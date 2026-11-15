import { describe, it, expect } from 'vitest';
import { noticeRequest, noticePayload, acceptModelLines, draftWithModel, DEFAULTS, type ModelConfig } from '../src';

const cfg: ModelConfig = { kind: 'anthropic', ...DEFAULTS.anthropic, apiKey: 'k' };
const NOTICE = 'We collect your email address. We do not collect precise geolocation.';

describe('privacy AI draft', () => {
  it('the only data in the request is the notice text', () => {
    expect(noticePayload(NOTICE)).toEqual({ notice: NOTICE });
    const req = noticeRequest(cfg, NOTICE);
    const body = req.body as { messages: { content: string }[]; system: string };
    expect(JSON.parse(body.messages[0].content)).toEqual({ notice: NOTICE });
    expect(body.system).toMatch(/Use ONLY these category ids/);
  });
  it('keeps lines whose category is real and whose quote is in the notice; drops the rest', () => {
    const { policy, rejected } = acceptModelLines({
      lines: [
        { category: 'user.contact.email', status: 'disclosed', quote: 'your email address' },
        { category: 'user.location.precise', status: 'not_collected', quote: 'We do not collect precise geolocation.' },
        { category: 'user.biometric', status: 'disclosed', quote: 'we scan your face' },
        { category: 'user.made_up', status: 'disclosed', quote: 'email' },
      ],
    }, NOTICE);
    expect(policy.categories.map((c) => [c.category, c.status, c.sentence, c.source])).toEqual([
      ['user.contact.email', 'disclosed', 's1', 'ai'], ['user.location.precise', 'not_collected', 's2', 'ai'],
    ]);
    expect(rejected).toHaveLength(2);
  });
  it('calls the model through the shared provider and validates the answer', async () => {
    const seen: string[] = [];
    const f = async (_u: string, init: RequestInit) => {
      seen.push(String(init.body));
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"lines":[{"category":"user.contact.email","status":"disclosed","quote":"your email address"}]}' }] }), { status: 200 });
    };
    const r = await draftWithModel(cfg, NOTICE, f);
    expect(r.policy.categories[0].category).toBe('user.contact.email');
    expect(seen[0]).toContain(JSON.stringify(JSON.stringify({ notice: NOTICE })).slice(1, -1));
    expect(seen[0]).not.toContain('"k"'); // the key goes in a header, not the body
  });
});
