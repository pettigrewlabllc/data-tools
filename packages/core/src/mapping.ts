import { parse, stringify } from 'yaml';
import type { Aggregate, JoinOn, KeyRef } from './grammar';
import type { Plan } from './joinsql';

export const TOOL = 'join-receipt';
export const TOOL_VERSION = '0.1.0';

export interface MappingJoin {
  id: string;
  left: KeyRef;
  right: KeyRef;
  how: JoinOn['how'];
  aggregate_left: Aggregate | null;
  aggregate_right: Aggregate | null;
  status: 'approved' | 'rejected' | 'proposed';
  proposed_by: 'rule' | 'llm' | 'user';
  llm: { model: string; prompt_sha256: string } | null;
  receipt: { matched: number; unmatched_left: number; unmatched_right: number; joined_rows: number; fanout: number; max_per_key_right: number };
}
export interface MappingTable { name: string; file: string; grain: string[] | null }
export interface Mapping { tool: string; version: string; tables: MappingTable[]; joins: MappingJoin[] }

export function planOf(j: MappingJoin): Plan {
  return { join: { op: 'join_on', left: j.left, right: j.right, how: j.how }, aggregateLeft: j.aggregate_left, aggregateRight: j.aggregate_right };
}

// Fixed key order, so the same decisions always produce the same bytes.
const keyRef = (k: KeyRef) => ({ table: k.table, column: k.column, transforms: k.transforms.map((t) => ({ ...t })) });
const agg = (a: Aggregate | null) => (a ? { op: a.op, table: a.table, by: [...a.by], measures: a.measures.map((m) => ({ column: m.column, fn: m.fn })) } : null);
const round = (x: number) => Math.round(x * 10000) / 10000;

export function canonical(m: Mapping): Mapping {
  return {
    tool: m.tool,
    version: m.version,
    tables: m.tables.map((t) => ({ name: t.name, file: t.file, grain: t.grain ? [...t.grain] : null })),
    joins: m.joins.map((j) => ({
      id: j.id,
      left: keyRef(j.left),
      right: keyRef(j.right),
      how: j.how,
      aggregate_left: agg(j.aggregate_left),
      aggregate_right: agg(j.aggregate_right),
      status: j.status,
      proposed_by: j.proposed_by,
      llm: j.llm ? { model: j.llm.model, prompt_sha256: j.llm.prompt_sha256 } : null,
      receipt: {
        matched: j.receipt.matched, unmatched_left: j.receipt.unmatched_left, unmatched_right: j.receipt.unmatched_right,
        joined_rows: j.receipt.joined_rows, fanout: round(j.receipt.fanout), max_per_key_right: j.receipt.max_per_key_right,
      },
    })),
  };
}

/** mapping.yml text. The `yaml` package quotes strings that would read back as numbers, booleans or null. */
export function toYaml(m: Mapping): string {
  const header = `# Join Receipt decisions. Regenerate SQL and Python from this file with the same tool version.\n`;
  return header + stringify(canonical(m), { indent: 2, lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' });
}

export function fromYaml(text: string): Mapping {
  const m = parse(text) as Mapping;
  if (!m || m.tool !== TOOL) throw new Error('not a join-receipt mapping.yml');
  return canonical(m);
}
