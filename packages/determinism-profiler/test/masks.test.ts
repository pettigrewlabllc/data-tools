import { describe, expect, it } from 'vitest';
import { ADDRESS_MASK, DEFAULT_MASKS, applyMasks, parseSanitize } from '../src/masks.js';

const mask = (line: string, masks = [ADDRESS_MASK, ...DEFAULT_MASKS]) => {
  const counts: Record<string, number> = {};
  return { out: applyMasks(line, masks, counts), counts };
};

describe('default masks', () => {
  it('masks ISO timestamps', () => {
    expect(mask('2026-11-14T09:30:01.123456 INFO total=42.00')).toEqual({ out: 'TIMESTAMP INFO total=42.00', counts: { timestamp: 1 } });
    expect(mask('from 2026-11-14 09:30 to 2026-11-14 10:00:00+00:00').counts).toEqual({ timestamp: 2 });
  });
  it('masks durations but leaves other numbers', () => {
    expect(mask('fit took 1.23s, 450 ms per batch, 40 rows')).toEqual({ out: 'fit took DURATION, DURATION per batch, 40 rows', counts: { duration: 2 } });
  });
  it('replaces a tqdm progress line whole', () => {
    expect(mask(' 45%|████▌     | 45/100 [00:01<00:01, 40.12it/s]')).toEqual({ out: 'PROGRESS', counts: { 'progress bar': 1 } });
  });
  it('masks memory addresses', () => {
    expect(mask('<Model object at 0x7f3a2b>').counts).toEqual({ 'memory address': 1 });
  });
  it('leaves a plain answer alone', () => {
    expect(mask('total=1234.5, 2026 rows')).toEqual({ out: 'total=1234.5, 2026 rows', counts: {} });
  });
});

describe('--sanitize (nbval format)', () => {
  it('reads sections, regex and replace lines', () => {
    const m = parseSanitize('# comment\n[run id]\nregex: run-[0-9a-f]{8}\nreplace: RUN-ID\n\n[dates]\nregex: (?P<d>\\d{1,2})/\\d{1,2}/\\d{4}\nreplace: DATE\n');
    expect(m.map((x) => x.name)).toEqual(['run id', 'dates']);
    expect(mask('run-1a2b3c4d on 3/14/2026', m)).toEqual({ out: 'RUN-ID on DATE', counts: { 'run id': 1, dates: 1 } });
  });
  it('says which line is wrong', () => {
    expect(() => parseSanitize('[a]\nregex: (unclosed\n', 's.cfg')).toThrow(/s\.cfg, line 1: \[a\] has a regex that doesn't parse/);
    expect(() => parseSanitize('regex: x\n', 's.cfg')).toThrow(/s\.cfg, line 1/);
    expect(() => parseSanitize('[a]\nreplace: x\n', 's.cfg')).toThrow(/\[a\] has no regex/);
  });
});

describe('masks after review', () => {
  it("doesn't touch decades, 'us' as a word, or abbreviations", () => {
    expect(mask('the 1990s, 12 us stores, mean 4.5 s.d.')).toEqual({ out: 'the 1990s, 12 us stores, mean 4.5 s.d.', counts: {} });
  });
  it('still masks real durations, including at the end of a sentence', () => {
    expect(mask('took 1.23s. Then 0.5 s, 450ms and 12 seconds.').counts).toEqual({ duration: 4 });
  });
  it('catches a bar-less tqdm line before the duration mask can eat it, and leaves a % table alone', () => {
    expect(mask('7/10 [00:03<00:09, 3.2s/it]')).toEqual({ out: 'PROGRESS', counts: { 'progress bar': 1 } });
    expect(mask('| 12%| 40 |')).toEqual({ out: '| 12%| 40 |', counts: {} });
  });
  it('sanitize: trims, maps \\A and \\Z, unescapes %%, honours (?i)', () => {
    const m = parseSanitize('[a]\nregex: \\Aid=\\d+\\Z   \nreplace: ID\n[b]\nregex: (?i)done in \\d+%%\nreplace: DONE\n');
    expect(mask('id=42', m).out).toBe('ID');
    expect(mask('DONE IN 80%', m).out).toBe('DONE');
  });
});
