/**
 * Canonical form, for comparing outputs across runtimes (ADR 0005): missing and null are the same; arrays stay
 * arrays; integers compare exactly; other numbers at 15 significant digits; strings after Unicode NFC; object
 * keys sorted.
 */
import type { Json } from './json';

export function canonical(v: Json | undefined): Json | undefined {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) return v.map((x) => canonical(x) ?? null);
  if (typeof v === 'number') return Number.isInteger(v) ? v : Number(v.toPrecision(15));
  if (typeof v === 'string') return v.normalize('NFC');
  if (typeof v === 'object') {
    const out: Record<string, Json> = {};
    for (const k of Object.keys(v).sort()) { const c = canonical(v[k]); if (c !== undefined) out[k] = c; }
    return Object.keys(out).length ? out : undefined;
  }
  return v;
}

export const canonicalText = (v: Json | undefined) => JSON.stringify(canonical(v) ?? null);

/** First difference between two outputs, as a path and both values, or null when they agree. */
export function firstDifference(a: Json | undefined, b: Json | undefined, path = ''): { path: string; a: unknown; b: unknown } | null {
  const ca = canonical(a), cb = canonical(b);
  if (JSON.stringify(ca) === JSON.stringify(cb)) return null;
  if (ca && cb && typeof ca === 'object' && typeof cb === 'object' && !Array.isArray(ca) && !Array.isArray(cb)) {
    for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
      const d = firstDifference((ca as Record<string, Json>)[k], (cb as Record<string, Json>)[k], path ? `${path}.${k}` : k);
      if (d) return d;
    }
  }
  return { path: path || '(record)', a: ca, b: cb };
}
