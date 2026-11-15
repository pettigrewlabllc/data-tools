import { buildRequest, callModel, type Fetcher, type ModelConfig } from '../ai/providers';
import { CATEGORIES, isCategory } from './taxonomy';
import { finishPolicy, splitSentences, emptyPolicy, type Policy, type PolicyLine, type Status } from './policy';
import { M } from './messages';

/** The only text a model sees besides this fixed instruction. */
export const NOTICE_PROMPT = `You read a privacy notice and list which personal information categories it says the company collects.
Use ONLY these category ids: ${CATEGORIES.filter((c) => c.id !== 'user').map((c) => c.id).join(', ')}.
For each category the notice mentions, give a status:
"disclosed" if the notice clearly says it collects it, "vague" if it only says so in a hedged or general way ("may collect", "identifiers"),
"not_collected" if the notice says it does not collect it.
Each line needs a "quote": the exact words from the notice that support it, copied character for character.
Never add a category the notice does not mention. Reply with JSON only, in this shape:
{"lines":[{"category":"user.contact.email","status":"disclosed","quote":"..."}]}`;

export const noticePayload = (notice: string) => ({ notice });

/** The exact request the panel shows before anything is sent. */
export const noticeRequest = (cfg: ModelConfig, notice: string) => buildRequest(cfg, noticePayload(notice), NOTICE_PROMPT);

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Check what a model returned against the notice. A line survives only if its category is real and its quote is in the notice. */
export function acceptModelLines(raw: unknown, notice: string): { policy: Policy; rejected: string[] } {
  const sentences = splitSentences(notice);
  const lines: PolicyLine[] = [];
  const rejected: string[] = [];
  const arr = (raw as { lines?: unknown })?.lines;
  for (const l of Array.isArray(arr) ? arr : []) {
    const o = l as Record<string, unknown>;
    const category = String(o.category ?? ''), status = String(o.status ?? '') as Status, quote = String(o.quote ?? '');
    if (!isCategory(category) || category === 'user') { rejected.push(M.aiRejectedCategory(category)); continue; }
    if (!['disclosed', 'vague', 'not_collected'].includes(status)) { rejected.push(M.aiRejectedCategory(category)); continue; }
    const s = quote && sentences.find((x) => squash(x.text).includes(squash(quote)));
    if (!s) { rejected.push(M.aiRejectedQuote(category)); continue; }
    if (lines.some((x) => x.category === category)) continue;
    lines.push({ category, status, sentence: s.id, quote: s.text, source: 'ai' });
  }
  return { policy: finishPolicy({ ...emptyPolicy(), categories: lines, sentences }), rejected };
}

export async function draftWithModel(cfg: ModelConfig, notice: string, f?: Fetcher) {
  const raw = await callModel(cfg, noticePayload(notice), f, NOTICE_PROMPT);
  return acceptModelLines(raw, notice);
}
