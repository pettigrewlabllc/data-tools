import type { TableProfile } from '../profile';
import type { JoinCandidate } from '../candidates';
import type { Receipt } from '../receipt';
import { ALLOWED_OPS } from '../grammar';
import { CROSSWALKS } from '../sql/crosswalks';
import { FORMAT_LABEL } from '../formats';

/** Values from public code lists (state and country codes and names) are not personal, so they are never masked. */
const PUBLIC = new Set(
  Object.values(CROSSWALKS).flatMap((c) => c.rows.flatMap((r) => Object.values(r).filter(Boolean).map((v) => String(v).toUpperCase()))),
);

/** Keep a value's shape, not its content: digits → 9, lower → a, upper → A, everything else as is. */
export function maskValue(v: string): string {
  if (PUBLIC.has(v.trim().toUpperCase())) return v;
  return v.replace(/[0-9]/g, '9').replace(/\p{Ll}/gu, 'a').replace(/\p{Lu}/gu, 'A');
}

export interface ColumnSummary {
  table: string; column: string; type: string; format: string;
  rows: number; distinct: number; nullPct: number; unique: boolean; minLen: number; maxLen: number;
  examples: string[];
}

export interface Payload {
  task: string;
  mode: 'masked' | 'raw';
  left: ColumnSummary;
  right: ColumnSummary;
  current: { transformsLeft: unknown[]; transformsRight: unknown[]; matchRate: number; unmatchedLeftExamples: string[]; unmatchedRightExamples: string[] };
  allowedOps: string[];
  crosswalks: Record<string, string[]>;
}

export const EXAMPLES = 8;

function summary(profiles: TableProfile[], table: string, column: string, mode: 'masked' | 'raw'): ColumnSummary {
  const p = profiles.find((x) => x.table === table)!;
  const c = p.columns.find((x) => x.name === column)!;
  const ex = c.samples.slice(0, EXAMPLES);
  return {
    table, column, type: c.type, format: FORMAT_LABEL[c.format], rows: p.rows, distinct: c.distinct,
    nullPct: Math.round(c.nullPct * 1000) / 1000, unique: c.unique, minLen: c.minLen, maxLen: c.maxLen,
    examples: mode === 'raw' ? ex : ex.map(maskValue),
  };
}

/** Exactly what would be sent to a model. The app shows this object before any call. */
export function buildPayload(
  profiles: TableProfile[], c: JoinCandidate, receipt: Receipt,
  unmatched: { left: string[]; right: string[] }, mode: 'masked' | 'raw',
): Payload {
  const m = (xs: string[]) => xs.slice(0, EXAMPLES).map((v) => (mode === 'raw' ? v : maskValue(v)));
  return {
    task: 'Propose transforms that make these two key columns match. Reply with JSON only.',
    mode,
    left: summary(profiles, c.left.table, c.left.column, mode),
    right: summary(profiles, c.right.table, c.right.column, mode),
    current: {
      transformsLeft: c.left.transforms, transformsRight: c.right.transforms,
      matchRate: Math.round(receipt.matchRateAfter * 1000) / 1000,
      unmatchedLeftExamples: m(unmatched.left), unmatchedRightExamples: m(unmatched.right),
    },
    allowedOps: [...ALLOWED_OPS],
    crosswalks: Object.fromEntries(Object.entries(CROSSWALKS).map(([k, v]) => [k, v.kinds])),
  };
}
