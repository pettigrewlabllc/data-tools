import { describe, expect, it } from 'vitest';
import { compareRuns } from '../src/compare.js';
import type { Fingerprint } from '../src/fingerprint.js';
import type { Trace, TraceStep } from '../src/types.js';

const f = (h: string, rows = 1, order_matters = false): Fingerprint => ({ rows, ordered: h, unordered: h, rounded: h, columns: {}, order_matters });
const step = (id: string, out: Fingerprint, inputs: Record<string, string> = {}, kind: TraceStep['kind'] = 'sql'): TraceStep =>
  ({ step_id: id, kind, label: id, location: { file: 'x' }, parents: Object.keys(inputs).map((k) => k.split('#')[0]), input_hashes: inputs, outputs: { o: out }, duration_ms: 1, status: 'ok' });
const trace = (run: number, steps: TraceStep[]): Trace =>
  ({ schema: 'determinism-profiler/trace@1', tool_version: 't', input: { kind: 'sql', name: 'x' }, run, started_at: '', params: {}, steps, notes: [] });

describe('attribution', () => {
  it('blames the upstream step whose inputs were identical (D4)', () => {
    const runs = [1, 2, 3].map((r) => trace(r, [
      step('a', f('same')),
      step('b', f('b' + r), { 'a#o': 'same' }),
      step('c', f('c' + r), { 'b#o': 'b' + r }),
    ]));
    const res = compareRuns(runs, []);
    const by = Object.fromEntries(res.steps.map((s) => [s.step_id, s]));
    expect(by.a.attribution).toBe('none');
    expect(by.b.attribution).toBe('origin');
    expect(by.c).toMatchObject({ attribution: 'inherited', from: ['b'] });
    expect(res.score).toEqual({ same: 1, scored: 3, percent: 33.3 });
  });
  it('a moved source makes downstream inconclusive, never blamed', () => {
    const runs = [1, 2].map((r) => trace(r, [
      step('source:d.csv', f('d' + r), {}, 'source'),
      step('b', f('b' + r), { 'source:d.csv#o': 'd' + r }),
    ]));
    const res = compareRuns(runs, []);
    expect(res.steps[0]).toMatchObject({ attribution: 'inconclusive', from: ['source:d.csv'] });
    expect(res.sources[0].verdict).toBe('values');
  });
  it('walks through a step that passed a changed input along unchanged', () => {
    const runs = [1, 2].map((r) => trace(r, [
      step('a', f('a' + r)),
      step('b', f('same'), { 'a#o': 'a' + r }),
      step('c', f('c' + r), { 'b#o': 'a' + r }),
    ]));
    const by = Object.fromEntries(compareRuns(runs, []).steps.map((s) => [s.step_id, s]));
    expect(by.b.verdict).toBe('same');
    expect(by.c).toMatchObject({ attribution: 'inherited', from: ['a'] });
  });
  it('failing in some runs but not others is a difference; failing the same way every run is not', () => {
    const mk = (status: TraceStep['status'], error?: string) => ({ ...step('a', f('x')), status, error });
    expect(compareRuns([trace(1, [mk('ok')]), trace(2, [mk('error', 'Conversion Error')])], []).steps[0].verdict).toBe('error');
    expect(compareRuns([trace(1, [mk('error', 'E')]), trace(2, [mk('error', 'E')])], []).steps[0].verdict).toBe('same');
  });
  it('confirms a finding on an origin, marks it latent on a step that matched', () => {
    const runs = [1, 2].map((r) => trace(r, [step('a', f('a' + r)), step('b', f('same'))]));
    const fs = [
      { file: 'x', line: 1, cause: 'random' as const, keyword: 'random', kind: 'definite' as const, step: 'a', status: 'pending' as const },
      { file: 'x', line: 2, cause: 'timestamp' as const, keyword: 'now', kind: 'definite' as const, step: 'b', status: 'pending' as const },
      { file: 'x', line: 3, cause: 'ties' as const, keyword: 'limit', kind: 'candidate' as const, step: 'b', status: 'pending' as const },
    ];
    expect(compareRuns(runs, fs).findings.map((x) => x.status)).toEqual(['confirmed', 'latent', 'candidate']);
  });
  it('leaves judgment steps out of the score', () => {
    const runs = [1, 2].map((r) => trace(r, [{ ...step('ai', f('a' + r)), judgment: true }, step('b', f('same'))]));
    expect(compareRuns(runs, []).score).toEqual({ same: 1, scored: 1, percent: 100 });
  });
});
