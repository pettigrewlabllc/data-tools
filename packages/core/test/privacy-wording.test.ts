import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The tool cites the rule and never gives a verdict. These words are not allowed anywhere a person can read them:
 * every source file in the privacy module and the web app (strings, messages, rules.yml, comments included).
 * If a statute title ever needs one of them, quote it in a citation field and add an explicit allowance below.
 */
const BANNED = ['compliant', 'compliance', 'violates', 'violation', 'identifiable', 're-identified', 'illegal', 'lawful'];
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [join(HERE, '../src/privacy'), join(HERE, '../../privacydiff/src'), join(HERE, '../../privacydiff/index.html')];

function files(p: string): string[] {
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((n) => files(join(p, n)));
}

describe('wording rule', () => {
  const all = ROOTS.flatMap(files).filter((f) => /\.(ts|tsx|yml|html|css)$/.test(f));
  it('scans the copy, messages, rules and the app', () => {
    const names = all.map((f) => f.split('/').slice(-1)[0]);
    for (const n of ['copy.ts', 'messages.ts', 'rules.yml', 'App.tsx']) expect(names, n).toContain(n);
  });
  it.each(all.map((f) => [f.replace(/^.*\/packages\//, '')]))('%s uses none of the banned words', (rel) => {
    const f = all.find((x) => x.endsWith(rel as string))!;
    const text = readFileSync(f, 'utf8').toLowerCase();
    const hits = BANNED.filter((w) => text.includes(w));
    expect(hits, `${rel} contains ${hits.join(', ')}`).toEqual([]);
  });
});
