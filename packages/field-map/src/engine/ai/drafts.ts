/**
 * A model's answer is untrusted JSON. Each proposed field must name a real target field, pass the grammar
 * validator and point at paths that exist in the samples; then it is scored like any rule's candidate. Anything
 * else is rejected and shown as rejected, with the reason.
 */
import { parsePath, validateMapping, type FieldMapping, type Path } from '../grammar';
import type { Json } from '../json';
import type { SourceProfile } from '../profile';
import { scoreProposal, type Candidate } from '../recommend';
import type { Target } from '../target';

export const PROMPT = `You map fields from sample API responses to a target shape.
You get the target fields, the source paths with profiles (types, format class, how often present, examples; some examples are masked by shape: 9 = digit, a = lowercase, A = uppercase), and the fields to propose.
Answer with JSON only: {"fields":[{"target":"<target id>","source":<source>,"transforms":[<transform>...]}]}.
A path is a list of keys, e.g. ["customer","email"]. For a field inside an array (in_array), paths are relative to the array item.
Sources: {"op":"path","path":[...]}, {"op":"coalesce","paths":[[...],[...]]}, {"op":"concat","paths":[[...],[...]],"sep":" "}, {"op":"pick","array":[...],"which":"first"|"last"|{"key":[...],"equals":<value>},"field":[...]}, {"op":"values","array":[...],"field":[...]}, {"op":"count","array":[...]}, {"op":"constant","value":<value>}.
Transforms: {"op":"trim"}, {"op":"lower"}, {"op":"upper"}, {"op":"cast","to":"string"|"integer"|"number"|"boolean"}, {"op":"parse_date","from":"iso"|"epoch_s"|"epoch_ms"|"epoch_us"|"epoch_ns"|"us_date","out":"date"|"date-time"}, {"op":"scale","power":-2}, {"op":"value_map","map":{"<source value>":"<target value>"}}.
At most 5 ops per field. Leave out any field you can't fill from the paths given. Never invent a path.`;

export interface Rejected { target: string; reason: string }
export interface DraftResult { accepted: { target: string; candidate: Candidate; modelValueMap: boolean }[]; rejected: Rejected[] }

function pathsIn(m: FieldMapping): Path[] {
  const s = m.source;
  if (s.op === 'path') return [s.path];
  if (s.op === 'coalesce' || s.op === 'concat') return s.paths;
  if (s.op === 'count') return [s.array];
  if (s.op === 'values' || s.op === 'pick') return [s.array];
  return [];
}

export async function acceptDrafts(raw: unknown, target: Target, profile: SourceProfile, records: Json[], arrayFor: (targetArray: string) => Path | null): Promise<DraftResult> {
  const out: DraftResult = { accepted: [], rejected: [] };
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { fields?: unknown }).fields) ? (raw as { fields: unknown[] }).fields : null;
  if (!list) return { accepted: [], rejected: [{ target: '(answer)', reason: 'the answer has no "fields" list' }] };
  for (const item of list) {
    const t = item && typeof item === 'object' ? String((item as { target?: unknown }).target ?? '') : '';
    const f = target.fields.find((x) => x.id === t);
    if (!f) { out.rejected.push({ target: t || '(no target)', reason: 'not a target field' }); continue; }
    const rec = item as Record<string, unknown>;
    const v = validateMapping({ target: f.path, source: rec.source, transforms: rec.transforms ?? [] });
    if (!v.ok) { out.rejected.push({ target: t, reason: v.error }); continue; }
    const ctx = f.context ? arrayFor(f.context.join('.') + '[]') : null;
    if (f.context && !ctx) { out.rejected.push({ target: t, reason: 'its array has no source yet' }); continue; }
    const known = new Set(profile.paths.filter((p) => JSON.stringify(p.context) === JSON.stringify(ctx)).map((p) => JSON.stringify(p.path)));
    const missing = pathsIn(v.mapping).find((p) => !known.has(JSON.stringify(p)));
    if (missing) { out.rejected.push({ target: t, reason: `the path ${missing.join('.')} isn't in the samples` }); continue; }
    const m = { ...v.mapping, sourceContext: ctx } as FieldMapping;
    const c = await scoreProposal(target, f, m, profile, records, ['model draft']);
    out.accepted.push({ target: t, candidate: { ...c, mapping: v.mapping }, modelValueMap: v.mapping.transforms.some((x) => x.op === 'value_map') });
  }
  return out;
}

export { parsePath };
