/**
 * What goes to a model, and nothing else. Default: names, types and profiles. Categorical values pass through
 * when a path has at most 50 distinct values and isn't email-shaped (the signal this job needs, like Join
 * Receipt's public codes); everything else is masked by shape. The payload panel shows exactly this object.
 */
import { crosswalkValues } from '../../shared/crosswalks';
import { SOURCE_OPS, TRANSFORM_OPS } from '../grammar';
import type { PathProfile, SourceProfile } from '../profile';
import type { FieldRec } from '../recommend';
import type { Target } from '../target';

const PUBLIC = new Set([...crosswalkValues('us_state', 'name'), ...crosswalkValues('us_state', 'abbr'), ...crosswalkValues('country', 'name'), ...crosswalkValues('country', 'iso2'), ...crosswalkValues('country', 'iso3')]);

/** Keep a value's shape, not its content: digits → 9, lower → a, upper → A. */
export function maskValue(v: string): string {
  if (PUBLIC.has(v.trim().toUpperCase())) return v;
  return v.replace(/[0-9]/g, '9').replace(/\p{Ll}/gu, 'a').replace(/\p{Lu}/gu, 'A');
}

export const passesThrough = (p: PathProfile) => p.distinct <= 50 && p.format !== 'email' && p.format !== 'free_text' && p.format !== 'url';

export interface Payload {
  task: string;
  target_fields: { id: string; type?: string; format?: string; enum?: unknown[]; description?: string; required: boolean; in_array?: string }[];
  source_paths: { id: string; types: Record<string, number>; format: string; present: string; distinct: number; examples: string[]; examples_masked: boolean; in_array?: string }[];
  ask_about: string[];
  allowed_source_ops: readonly string[];
  allowed_transforms: readonly string[];
}

export const EXAMPLES = 6;

export function buildPayload(target: Target, profile: SourceProfile, recs: FieldRec[], fieldIds?: string[]): Payload {
  const ask = fieldIds ?? recs.filter((r) => r.status !== 'confident').map((r) => r.field.id);
  return {
    task: 'Map source JSON paths to target fields using only the allowed ops. Answer with JSON: {"fields":[{"target":"<target field id>","source":{...},"transforms":[...]}]}. Leave a field out when nothing fits.',
    target_fields: target.fields.filter((f) => f.kind !== 'object_array').map((f) => ({ id: f.id, type: f.type ?? f.itemType, format: f.format, enum: f.enum, description: f.description, required: f.required, in_array: f.context ? f.context.join('.') + '[]' : undefined })),
    source_paths: profile.paths.filter((p) => p.kind !== 'object').map((p) => {
      const raw = p.values.slice(0, EXAMPLES).map((v) => String(v));
      const through = passesThrough(p);
      return { id: p.id, types: p.types as Record<string, number>, format: p.format, present: `${p.present} of ${p.total}`, distinct: p.distinct, examples: through ? raw : raw.map(maskValue), examples_masked: !through, in_array: p.context ? p.context.join('.') + '[]' : undefined };
    }),
    ask_about: ask,
    allowed_source_ops: SOURCE_OPS.filter((o) => o !== 'nested'),
    allowed_transforms: TRANSFORM_OPS,
  };
}
