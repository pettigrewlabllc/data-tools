/** Checking single values against a target field's rules, with the same ajv and formats as full validation. */
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import type { TargetField } from './target';

let ajv: Ajv2020 | null = null;
export function getAjv(): Ajv2020 {
  if (!ajv) { ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true }); addFormats(ajv); }
  return ajv;
}

const cache = new Map<string, ValidateFunction>();

/** True when the field has anything to check beyond "present". */
export const hasRules = (f: TargetField) =>
  !!(f.type || f.itemType || f.format || f.enum || f.pattern || f.minimum !== undefined || f.maximum !== undefined || f.multipleOf !== undefined || f.minLength !== undefined || f.maxLength !== undefined);

export function fieldSchema(f: TargetField): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  const type = f.kind === 'scalar_array' ? f.itemType : f.type;
  if (type) s.type = type;
  for (const k of ['format', 'enum', 'pattern', 'minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength'] as const) if (f[k] !== undefined) s[k] = f[k];
  return s;
}

export function valueChecker(f: TargetField): (v: unknown) => boolean {
  const schema = fieldSchema(f);
  const key = JSON.stringify(schema);
  let fn = cache.get(key);
  if (!fn) { fn = getAjv().compile(schema); cache.set(key, fn); }
  return (v) => fn!(v);
}
