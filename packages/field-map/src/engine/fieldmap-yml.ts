/**
 * `fieldmap.yml`: the decision, kept. One entry per target field with its mapping (in the grammar), score and
 * parts, who proposed it, and the answer to any question asked. It pins the tool version and the exact
 * `jsonata` version, because JSONata's 2.x point releases have changed the output of existing expressions.
 * The same file and versions regenerate byte-identical transform text.
 */
import { parse, stringify } from 'yaml';
import { validateMapping, type FieldMapping } from './grammar';
import type { Json } from './json';

export const TOOL_VERSION = '0.1.0';
export const JSONATA_VERSION = '2.2.2';

export interface FieldDecision {
  target: string;
  mapping: FieldMapping;
  score: number | null;
  parts?: Record<string, number>;
  proposed_by: 'rule' | 'llm' | 'user';
  model?: string;
  prompt_hash?: string;
  answer?: string;
  children?: Omit<FieldDecision, 'mapping'>[];
}

export interface FieldMapFile {
  field_map: 1;
  tool_version: string;
  jsonata_version: string;
  target: { kind: string; hash: string };
  samples: { records: number; hash: string };
  thresholds: { T: number; G: number };
  fields: FieldDecision[];
  unmapped?: string[];
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export const hashRecords = (records: Json[]) => sha256(records.map((r) => JSON.stringify(r)).join('\n'));

export function writeFieldMap(f: FieldMapFile): string {
  return '# Field Map decisions. Edit by hand if you like; the transform is regenerated from this file.\n' + stringify(f, { lineWidth: 0, sortMapEntries: false });
}

export function readFieldMap(text: string): FieldMapFile {
  const raw = parse(text) as FieldMapFile;
  if (!raw || raw.field_map !== 1) throw new Error('not a fieldmap.yml (field_map: 1 is missing)');
  if (raw.jsonata_version !== JSONATA_VERSION) throw new Error(`this file was made with jsonata ${raw.jsonata_version}; this build runs ${JSONATA_VERSION}, and its output can differ`);
  for (const d of raw.fields ?? []) {
    const r = validateMapping(d.mapping);
    if (!r.ok) throw new Error(`${d.target}: ${r.error}`);
  }
  return raw;
}

export const mappingsOf = (f: FieldMapFile): FieldMapping[] => f.fields.map((d) => d.mapping);
