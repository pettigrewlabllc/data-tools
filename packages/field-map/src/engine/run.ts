/** Runs a compiled JSONata transform. evaluate() is async in JSONata 2.x, so everything above this is too. */
import jsonata from 'jsonata';
import type { Json } from './json';

export type Compiled = ReturnType<typeof jsonata>;
const cache = new Map<string, Compiled>();

export function compile(text: string): Compiled {
  let c = cache.get(text);
  if (!c) { c = jsonata(text); cache.set(text, c); if (cache.size > 500) cache.delete(cache.keys().next().value!); }
  return c;
}

export async function runRecord(text: string, record: Json): Promise<Json | undefined> {
  return (await compile(text).evaluate(record)) as Json | undefined;
}

export async function runAll(text: string, records: Json[]): Promise<(Json | undefined)[]> {
  const c = compile(text);
  const out: (Json | undefined)[] = [];
  for (const r of records) out.push((await c.evaluate(r)) as Json | undefined);
  return out;
}
