import type { Db } from '../db';
import type { TableProfile } from '../profile';
import type { JoinCandidate } from '../candidates';
import type { Plan } from '../joinsql';
import type { Transform } from '../grammar';
import { validateTransforms } from '../grammar';
import { buildReceipt, type Receipt } from '../receipt';
import { callModel, type Fetcher, type ModelConfig } from './providers';
import type { Payload } from './payload';

export type Draft =
  | { ok: true; left: Transform[]; right: Transform[]; why: string; receipt: Receipt; delta: number }
  | { ok: false; raw: unknown; error: string };

export const MAX_PROPOSALS = 5;

/** Validate a model's answer against the closed grammar, then run and score every valid proposal. Nothing unscored is returned. */
export async function scoreProposals(db: Db, profiles: TableProfile[], plan: Plan, base: Receipt, answer: unknown): Promise<Draft[]> {
  const list = (answer as { proposals?: unknown })?.proposals;
  if (!Array.isArray(list)) return [{ ok: false, raw: answer, error: 'the reply had no "proposals" list' }];
  const out: Draft[] = [];
  for (const p of list.slice(0, MAX_PROPOSALS)) {
    const obj = (p ?? {}) as Record<string, unknown>;
    const l = validateTransforms(obj.left ?? []);
    const r = validateTransforms(obj.right ?? []);
    if (!l.ok || !r.ok) { out.push({ ok: false, raw: p, error: (!l.ok ? l.error : !r.ok ? r.error : '') }); continue; }
    const why = typeof obj.why === 'string' ? obj.why.slice(0, 200) : '';
    try {
      const receipt = await buildReceipt(db, profiles, { ...plan, join: { ...plan.join, left: { ...plan.join.left, transforms: l.value }, right: { ...plan.join.right, transforms: r.value } } });
      out.push({ ok: true, left: l.value, right: r.value, why, receipt, delta: receipt.matchRateAfter - base.matchRateAfter });
    } catch (e) {
      out.push({ ok: false, raw: p, error: `could not run: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}` });
    }
  }
  return out.sort((a, b) => (b.ok ? b.delta : -2) - (a.ok ? a.delta : -2));
}

export async function draftFixes(
  db: Db, profiles: TableProfile[], c: JoinCandidate, plan: Plan, base: Receipt,
  payload: Payload, cfg: ModelConfig, f?: Fetcher,
): Promise<Draft[]> {
  const answer = await callModel(cfg, payload, f);
  return scoreProposals(db, profiles, plan, base, answer);
}
