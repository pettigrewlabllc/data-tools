/**
 * F7. Runs the mapping over every sample and validates each output record against the target with ajv
 * (`Ajv2020` for 2020-12, `Ajv` for draft-07, `ajv-formats` for `format`). Per-field rates come from
 * per-field expressions; `fieldValuesAgree` checks they match the full transform.
 */
import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { compileField, compileJsonata } from './emit-jsonata';
import type { FieldMapping } from './grammar';
import type { Json } from './json';
import { getAjv } from './rules';
import { runAll } from './run';
import type { Target } from './target';

let ajv07: Ajv | null = null;
function ajvFor(t: Target) {
  if (t.draft === '07') {
    if (!ajv07) { ajv07 = new Ajv({ allErrors: true, strict: false }); addFormats(ajv07); }
    return ajv07;
  }
  return getAjv();
}

export interface FieldValidation { field: string; pass: number; of: number; failures: { record: number; reason: string }[] }
export interface Validation { records: number; passing: number; fields: FieldValidation[]; outputs: (Json | undefined)[]; failing: { record: number; errors: string[] }[] }

const fieldOf = (e: ErrorObject): string => {
  const parts = e.instancePath.split('/').filter(Boolean).map((p) => (/^\d+$/.test(p) ? '[]' : p));
  if (e.keyword === 'required') parts.push(String((e.params as { missingProperty: string }).missingProperty));
  return parts.join('.').replace(/\.\[\]/g, '[]');
};

export function describeError(e: ErrorObject): string {
  const where = fieldOf(e) || 'the record';
  if (e.keyword === 'required') return `${where} is missing`;
  if (e.keyword === 'type') return `${where} should be ${(e.params as { type: string }).type}`;
  if (e.keyword === 'format') return `${where} isn't a valid ${(e.params as { format: string }).format}`;
  if (e.keyword === 'enum') return `${where} isn't one of the allowed values`;
  return `${where} ${e.message ?? 'fails a rule'}`;
}

export async function validateMapping(target: Target, mappings: FieldMapping[], records: Json[]): Promise<Validation> {
  const outputs = await runAll(compileJsonata(mappings), records);
  const fields = new Map<string, FieldValidation>();
  for (const f of target.fields) fields.set(f.id, { field: f.id, pass: 0, of: 0, failures: [] });
  const failing: Validation['failing'] = [];
  if (!target.schema) {
    // A column list has no rules: every record "passes", and the per-field count is how often it's filled.
    outputs.forEach((o) => {
      for (const f of target.fields) {
        const fv = fields.get(f.id)!;
        fv.of++;
        if (f.context === null && f.kind !== 'object_array' && getAt(o, f.path) !== undefined) fv.pass++;
      }
    });
    return { records: records.length, passing: records.length, fields: [...fields.values()], outputs, failing };
  }
  const validate = ajvFor(target).compile(target.schema);
  outputs.forEach((o, i) => {
    const ok = validate(o ?? {});
    const errs = ok ? [] : (validate.errors ?? []);
    const bad = new Map<string, string>();
    for (const e of errs) { const id = fieldOf(e); if (!bad.has(id)) bad.set(id, describeError(e)); }
    for (const fv of fields.values()) {
      fv.of++;
      const reason = bad.get(fv.field) ?? [...bad.entries()].find(([k]) => k.startsWith(fv.field.replace(/\[\]$/, '')))?.[1];
      if (reason) { if (fv.failures.length < 20) fv.failures.push({ record: i, reason }); } else fv.pass++;
    }
    if (!ok) failing.push({ record: i, errors: [...new Set(errs.map(describeError))].slice(0, 6) });
  });
  return { records: records.length, passing: records.length - failing.length, fields: [...fields.values()], outputs, failing };
}

function getAt(v: Json | undefined, p: string[]): Json | undefined {
  let cur = v;
  for (const k of p) cur = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur[k] : undefined;
  return cur;
}

/** True when each field's own expression gives the same value as that field in the full transform. */
export async function fieldValuesAgree(mappings: FieldMapping[], records: Json[]): Promise<{ ok: boolean; field?: string; record?: number }> {
  const full = await runAll(compileJsonata(mappings), records);
  for (const m of mappings) {
    const own = await runAll(compileField(m), records);
    for (let i = 0; i < records.length; i++) {
      const a = JSON.stringify(getAt(own[i], m.target) ?? null), b = JSON.stringify(getAt(full[i], m.target) ?? null);
      if (a !== b) return { ok: false, field: m.target.join('.'), record: i };
    }
  }
  return { ok: true };
}
