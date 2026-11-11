import type { KeyPair, KeyRef, Transform } from './grammar';

export interface Features {
  containLeft: number; containRight: number; overlap: number;
  leftUnique: boolean; rightUnique: boolean; formatMatch: boolean; nameSim: number;
  minDistinct: number; bothRowNumbers: boolean;
  /** Set when a side is unique except for one shared value (see ColumnProfile.nearUnique). */
  leftNearUnique?: { value: string; rows: number } | null; rightNearUnique?: { value: string; rows: number } | null;
}

export const SCORE_LABEL = 'heuristic, not a probability';

function words(col: string, table: string): string[] {
  const parts = col.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // A bare `id` (or key/code) means "this table's id": customers.id ≈ orders.customer_id.
  if (parts.length === 1 && ['id', 'key', 'code'].includes(parts[0])) {
    const t = table.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).pop() ?? '';
    return [t.replace(/ies$/, 'y').replace(/s$/, ''), parts[0]];
  }
  return parts;
}

/** Token overlap between two column names (Jaccard), with bare `id` read as `<table>_id`. */
export function nameSimilarity(a: string, b: string, tableA = '', tableB = ''): number {
  const x = new Set(words(a, tableA));
  const y = new Set(words(b, tableB));
  if (!x.size || !y.size) return 0;
  const inter = [...x].filter((w) => y.has(w)).length;
  return inter / new Set([...x, ...y]).size;
}

export function describeTransforms(ts: Transform[]): string {
  return ts.map((t) => {
    switch (t.op) {
      case 'lpad': return t.fill === '0' ? `zero-padding to ${t.width}` : `padding to ${t.width}`;
      case 'crosswalk': return `${t.from} → ${t.to} lookup`;
      case 'trim': return 'trimming spaces';
      case 'lower': case 'upper': return 'ignoring case';
      case 'cast': return `reading as ${t.to}`;
      case 'date_trunc': return `rounding dates to the ${t.unit}`;
    }
  }).filter((v, i, a) => a.indexOf(v) === i).join(', ');
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * 0–100, labelled "heuristic, not a probability". Weights: containment 0.45, a unique side 0.25,
 * matching format 0.15, similar names 0.15; penalties for many-to-many, near-constant columns,
 * row numbers on both sides and each transform needed.
 */
export function scoreCandidate(f: Features, left: KeyRef, right: KeyRef, also: KeyPair[] = []): { score: number; reason: string } {
  const contain = Math.max(f.containLeft, f.containRight);
  const near = !f.leftUnique && !f.rightUnique ? (f.rightNearUnique ? { side: right, ...f.rightNearUnique } : f.leftNearUnique ? { side: left, ...f.leftNearUnique } : null) : null;
  let s = 100 * (0.45 * contain + 0.25 * (f.leftUnique || f.rightUnique ? 1 : near ? 0.8 : 0) + 0.15 * (f.formatMatch ? 1 : 0) + 0.15 * f.nameSim);
  const notes: string[] = [];
  if (near) notes.push(`${near.side.table}.${near.side.column} is unique except for ${near.rows} rows that share ${near.value}`);
  else if (!f.leftUnique && !f.rightUnique) { s -= 30; notes.push('neither side is unique, so rows would multiply'); }
  if (f.minDistinct < 3) { s -= 60; notes.push('too few distinct values to be a key'); }
  if (f.bothRowNumbers) { s -= 45; notes.push('both columns look like row numbers'); }
  const all = [left, right, ...also.flatMap((p) => [p.left, p.right])];
  const nT = all.reduce((n, k) => n + k.transforms.length, 0);
  s -= 2 * nT;
  const score = Math.max(0, Math.min(100, Math.round(s)));

  const fixes = describeTransforms(all.flatMap((k) => k.transforms));
  const cols = (side: 'left' | 'right') => [side === 'left' ? left : right, ...also.map((p) => p[side])].map((k) => k.column).join(' × ');
  const parts = [
    `${pct(f.containLeft)} of ${left.table} keys found in ${right.table}${fixes ? ` after ${fixes}` : ''}`,
    also.length && f.leftUnique && f.rightUnique ? `each file has one row per key (${cols('left')} = ${cols('right')})` : '',
    !also.length && f.rightUnique ? `${right.table}.${right.column} is unique` : !also.length && f.leftUnique ? `${left.table}.${left.column} is unique` : '',
    f.nameSim >= 0.5 ? `names match (${left.column} ↔ ${right.column})` : '',
    ...notes,
  ].filter(Boolean);
  return { score, reason: parts.join('; ') + '.' };
}
