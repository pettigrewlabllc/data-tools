import { readFileSync } from 'node:fs';

/**
 * Masks for notebook printed output: things that change every run without meaning anything
 * (a timestamp in a log line, "took 1.23s", a progress bar). Every replacement is counted and
 * shown on the report, so masking is never silent.
 */
export interface Mask {
  /** Shown on the report: a default's plain name, or the [section] name from a --sanitize file. */
  name: string;
  re: RegExp;
  replace: string;
  /** Defaults are pluralised on the report; --sanitize sections are shown as written. */
  builtin?: boolean;
  /** Replace the whole line when the pattern matches anywhere in it. */
  wholeLine?: boolean;
}

export const ADDRESS_MASK: Mask = { name: 'memory address', re: / at 0x[0-9a-fA-F]+/g, replace: ' at 0x?', builtin: true };

export const DEFAULT_MASKS: Mask[] = [
  // 2026-11-14T09:30:00, 2026-11-14 09:30:00.123456+00:00, ...Z
  { name: 'timestamp', re: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, replace: 'TIMESTAMP', builtin: true },
  // 1.23s, 450 ms, 12.5 seconds, 3µs (a number glued to or one space from a time unit)
  { name: 'duration', re: /\b\d+(?:\.\d+)?\s?(?:ns|µs|us|ms|s|sec|secs|seconds)\b/g, replace: 'DURATION', builtin: true },
  // tqdm: " 45%|████▌     | 45/100 [00:01<00:01, 40.12it/s]"
  { name: 'progress bar', re: /\d+%\|.*\||\d+(?:\.\d+)?(?:it|s)\/(?:s|it)\]/, replace: 'PROGRESS', builtin: true, wholeLine: true },
];

/**
 * nbval's sanitize format (https://nbval.readthedocs.io):
 *   [section name]
 *   regex: \d{1,2}/\d{1,2}/\d{2,4}
 *   replace: DATE-STAMP
 * Python named groups (?P<x>...) are converted to JavaScript's (?<x>...).
 */
export function parseSanitize(text: string, file = 'sanitize file'): Mask[] {
  const masks: Mask[] = [];
  let cur: { name: string; regex?: string; replace?: string; line: number } | null = null;
  const finish = () => {
    if (!cur) return;
    if (!cur.regex) throw new Error(`${file}: [${cur.name}] has no regex: line.`);
    let re: RegExp;
    try { re = new RegExp(cur.regex.replace(/\(\?P</g, '(?<'), 'g'); }
    catch (e) { throw new Error(`${file}, line ${cur.line}: [${cur.name}] has a regex that doesn't parse (${(e as Error).message}).`); }
    masks.push({ name: cur.name, re, replace: cur.replace ?? '' });
  };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) return;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { finish(); cur = { name: sec[1].trim(), line: i + 1 }; return; }
    const kv = /^(regex|replace)\s*[:=]\s?(.*)$/.exec(raw.trimStart());
    if (!kv || !cur) throw new Error(`${file}, line ${i + 1}: expected [section], regex: or replace:.`);
    if (kv[1] === 'regex') cur.regex = kv[2]; else cur.replace = kv[2];
  });
  finish();
  return masks;
}

export function loadSanitize(path: string): Mask[] {
  return parseSanitize(readFileSync(path, 'utf8'), path);
}

/** Applies masks to one line, adding each replacement to `counts`. */
export function applyMasks(line: string, masks: Mask[], counts: Record<string, number>): string {
  let out = line;
  for (const m of masks) {
    if (m.wholeLine) {
      if (m.re.test(out)) { counts[m.name] = (counts[m.name] ?? 0) + 1; out = m.replace; }
      continue;
    }
    out = out.replace(m.re, () => { counts[m.name] = (counts[m.name] ?? 0) + 1; return m.replace; });
  }
  return out;
}
