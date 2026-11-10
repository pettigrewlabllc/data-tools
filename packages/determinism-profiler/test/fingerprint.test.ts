import { describe, expect, it } from 'vitest';
import { Fingerprinter, encodeValue } from '../src/fingerprint.js';
import { outputVerdict } from '../src/compare.js';

const fp = (rows: unknown[][], orderMatters = true, cols = ['a', 'b']) => {
  const f = new Fingerprinter(cols, orderMatters);
  rows.forEach((r) => f.addRow(r));
  return f.finish();
};

describe('fingerprint', () => {
  it('tells order apart from content', () => {
    const a = fp([[1, 'x'], [2, 'y']]);
    const b = fp([[2, 'y'], [1, 'x']]);
    expect(a.ordered).not.toBe(b.ordered);
    expect(a.unordered).toBe(b.unordered);
    expect(outputVerdict([a, b]).verdict).toBe('order');
    expect(outputVerdict([fp([[1, 'x'], [2, 'y']], false), fp([[2, 'y'], [1, 'x']], false)]).verdict).toBe('same');
  });
  it('counts duplicates (sum, not xor)', () => {
    expect(fp([[1, 'x'], [1, 'x']]).unordered).not.toBe(fp([[2, 'y'], [2, 'y']]).unordered);
    expect(fp([[1, 'x'], [1, 'x']]).unordered).not.toBe(fp([[1, 'x']]).unordered);
  });
  it('calls last-digit noise float, and real changes values', () => {
    const a = fp([[0.1 + 0.2, 'x']]);
    const b = fp([[0.3, 'x']]);
    expect(outputVerdict([a, b]).verdict).toBe('float');
    expect(outputVerdict([a, fp([[0.31, 'x']])]).verdict).toBe('values');
    expect(outputVerdict([a, fp([[0.3, 'x'], [1, 'z']])]).verdict).toBe('rows');
  });
  it('names the columns that moved', () => {
    expect(outputVerdict([fp([[1, 'x']]), fp([[1, 'y']])]).columns).toEqual(['b']);
  });
  it('encodes types so 1 and "1" differ', () => {
    expect(encodeValue(1)).not.toBe(encodeValue('1'));
    expect(encodeValue(null)).not.toBe(encodeValue('null'));
  });
  it('never keeps values', () => {
    expect(JSON.stringify(fp([['CANARY_7f3a', 987654.321]]))).not.toMatch(/CANARY|987654/);
  });
});
