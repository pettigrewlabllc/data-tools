import { describe, it, expect } from 'vitest';
import { scoreCandidate, type Features } from '../src';

const k = (column: string, transforms: never[] = []) => ({ table: 't', column, transforms });
const f = (x: Partial<Features>): Features => ({ containLeft: 0, containRight: 0, overlap: 10, leftUnique: false, rightUnique: false, formatMatch: false, nameSim: 0, minDistinct: 100, bothRowNumbers: false, ...x });

describe('score parts', () => {
  it('returns the weighted parts behind the score, and they add up to it', () => {
    const s = scoreCandidate(f({ containLeft: 0.8, rightUnique: true, formatMatch: true, nameSim: 0.5 }), k('a'), k('b'));
    expect(s.parts.map((p) => [p.id, Math.round(p.points * 10) / 10])).toEqual([['found', 36], ['unique', 25], ['format', 15], ['names', 7.5]]);
    expect(s.score).toBe(Math.round(s.parts.reduce((a, p) => a + p.points, 0)));
    expect(s.capped).toBe(false);
  });

  it('lists penalties as negative parts, and says when the total was capped at 0', () => {
    const s = scoreCandidate(f({ containLeft: 0.1, minDistinct: 2, bothRowNumbers: true }), k('a', [{ op: 'trim' } as never]), k('b'));
    const byId = Object.fromEntries(s.parts.map((p) => [p.id, p.points]));
    expect(byId['not-unique']).toBe(-30);
    expect(byId['few-values']).toBe(-60);
    expect(byId['row-numbers']).toBe(-45);
    expect(byId['cleanup']).toBe(-2);
    expect(s.score).toBe(0);
    expect(s.capped).toBe(true);
  });

  it('gives a nearly unique side most of the unique points, with no penalty', () => {
    const s = scoreCandidate(f({ containLeft: 1, rightNearUnique: { value: '00', rows: 14 } }), k('a'), k('b'));
    expect(s.parts.find((p) => p.id === 'unique')?.points).toBe(20);
    expect(s.parts.some((p) => p.id === 'not-unique')).toBe(false);
  });
});
