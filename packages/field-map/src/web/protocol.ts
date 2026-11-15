import type { DraftResult } from '../engine/ai/drafts';
import type { Payload } from '../engine/ai/payload';
import type { FieldMapping, Path } from '../engine/grammar';
import type { Json, LoadError } from '../engine/json';
import type { SourceProfile } from '../engine/profile';
import type { Candidate, FieldRec } from '../engine/recommend';
import type { Loosen, Target, TargetKind } from '../engine/target';
import type { Validation } from '../engine/validate';

export type Req =
  | { type: 'load'; files: { name: string; text: string }[] }
  | { type: 'infer'; text: string; loosen: Loosen }
  | { type: 'recommend'; kind: TargetKind; text: string; loosen: Loosen }
  | { type: 'score'; field: string; mapping: FieldMapping; sourceContext: Path | null }
  | { type: 'validate'; mappings: FieldMapping[]; header: string }
  | { type: 'payload' }
  | { type: 'drafts'; answer: unknown; arrays: Record<string, Path> };

export type Res =
  | { type: 'loaded'; files: { name: string; records: number; recordRoot: string[] | null }[]; errors: LoadError[]; records: number; bigIntPaths: string[]; paths: number; thin: boolean }
  | { type: 'inferred'; schema: string }
  | { type: 'recommended'; target: Target; recs: FieldRec[]; records: number; thin: boolean; scoreWithoutRules: boolean; profile: SourceProfile }
  | { type: 'scored'; field: string; candidate: Candidate }
  | { type: 'validated'; validation: Validation; jsonata: string; python: string; mapped: Json[] }
  | { type: 'payload'; payload: Payload }
  | { type: 'drafts'; result: DraftResult };

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let next = 1;
const waiting = new Map<number, { ok: (r: Res) => void; fail: (e: Error) => void }>();
worker.onmessage = (e: MessageEvent<{ id: number; res?: Res; error?: string }>) => {
  const w = waiting.get(e.data.id);
  if (!w) return;
  waiting.delete(e.data.id);
  if (e.data.error) w.fail(new Error(e.data.error)); else w.ok(e.data.res!);
};

export function call<T extends Res['type']>(req: Req): Promise<Extract<Res, { type: T }>> {
  const id = next++;
  return new Promise((ok, fail) => { waiting.set(id, { ok: ok as (r: Res) => void, fail }); worker.postMessage({ id, req }); });
}
