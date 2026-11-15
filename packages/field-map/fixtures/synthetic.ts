/**
 * Synthetic vendor payloads for the families real public APIs don't show cleanly: three prices in one order,
 * amounts in cents, fields that are sometimes present, ids above 2^53, split names, enum codes in the wrong
 * case, microsecond and nanosecond epochs. Deterministic (seeded); regenerate with `npx tsx fixtures/synthetic.ts`.
 * Every file says "synthetic" in its name and in SOURCES.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let seed = 20261114;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const FIRST = ['Ada', 'Grace', 'Alan', 'Katherine', 'Edsger', 'Barbara', 'Donald', 'Frances', 'Ken', 'Radia', 'Leslie', 'Margaret'];
const LAST = ['Lovelace', 'Hopper', 'Turing', 'Johnson', 'Dijkstra', 'Liskov', 'Knuth', 'Allen', 'Thompson', 'Perlman', 'Lamport', 'Hamilton'];
const SKUS = ['TEA-001', 'MUG-014', 'KET-220', 'BAG-007', 'SPN-030'];
const BASE = 1763100000; // 2025-11-14, epoch seconds

function order(i: number) {
  const first = pick(FIRST), last = pick(LAST);
  const list = int(15, 90) * 100 - 1;
  const sale = Math.round(list * pick([0.8, 0.9, 1]));
  const items = Array.from({ length: int(1, 3) }, () => ({ sku: pick(SKUS), qty: int(1, 4), unit_price_cents: pick([499, 1299, 2450, 899]) }));
  return { i, first, last, list, sale, items, placed: BASE + i * 5437 + int(0, 900) };
}

const N = 24;
const orders = Array.from({ length: N }, (_, i) => order(i));

const files: Record<string, unknown> = {
  // Prices: list, sale and unit price, all in dollars with cents, and a customer object.
  'synthetic-orders-prices.json': { orders: orders.map((o) => ({
    order_id: `ORD-${10400 + o.i}`, placed_at: new Date(o.placed * 1000).toISOString().replace('.000', ''),
    list_price: o.list / 100, sale_price: o.sale / 100, unit_price: Math.round(o.sale / o.items.length) / 100,
    currency: 'USD', customer: { id: `C${700 + (o.i % 9)}`, email: `${o.first.toLowerCase()}.${o.last.toLowerCase()}@example.com`, first_name: o.first, last_name: o.last },
    line_items: o.items.map((it) => ({ sku: it.sku, quantity: it.qty, unit_price_cents: it.unit_price_cents })),
  })) },
  // Cents, with no name saying so; epoch seconds; enum codes upper case; a total in an *_cents field.
  'synthetic-orders-cents.json': orders.map((o) => ({
    id: 5000 + o.i, created: o.placed, amount: o.sale, total_cents: o.sale + 599, status: pick(['PAID', 'PAID', 'REFUNDED', 'PENDING']),
    buyer: { email_address: `${o.first[0].toLowerCase()}${o.last.toLowerCase()}@example.org` },
  })),
  // Sometimes present: email moved from top level to contact.email halfway through; phone sometimes missing.
  'synthetic-orders-drift.ndjson': orders.map((o) => JSON.stringify({
    ref: `R-${o.i}`, ...(o.i % 2 ? { contact: { email: `${o.first.toLowerCase()}@example.net` } } : { email: `${o.first.toLowerCase()}@example.net` }),
    ...(o.i % 4 ? { phone: `+1-555-01${String(o.i).padStart(2, '0')}` } : {}), given_name: o.first, family_name: o.last,
    updated: (o.placed + 120) * 1_000_000, ts_ns: `${(o.placed + 60)}${String(int(0, 999999999)).padStart(9, '0')}`,
  })).join('\n'),
};

// Big ids: written by hand so they stay digits past 2^53 (JSON.stringify would round them).
const bigLines = orders.map((o) => `{"id": ${9007199254740993n + BigInt(o.i * 7919)}, "account_id": "${1000 + (o.i % 5)}", "name": "${o.first} ${o.last}", "is_active": ${o.i % 3 ? '"yes"' : '"no"'}, "score": "${int(10, 99)}"}`);
files['synthetic-accounts-bigint.json'] = null;

for (const [name, body] of Object.entries(files)) {
  if (body === null) continue;
  writeFileSync(join(import.meta.dirname, 'samples', name), (typeof body === 'string' ? body : JSON.stringify(body, null, 1)) + '\n');
}
writeFileSync(join(import.meta.dirname, 'samples', 'synthetic-accounts-bigint.json'), `[\n${bigLines.join(',\n')}\n]\n`);

const srcPath = join(import.meta.dirname, 'samples', 'SOURCES.json');
const sources = (JSON.parse(readFileSync(srcPath, 'utf8')) as { file: string }[]).filter((s) => !s.file.startsWith('synthetic-'));
for (const name of Object.keys(files)) sources.push({ file: name, url: 'fixtures/synthetic.ts', licence: 'MIT (generated for this repo)', note: 'Synthetic: generated, not from a real API' } as never);
writeFileSync(srcPath, JSON.stringify(sources, null, 2) + '\n');
console.log(Object.keys(files).join('\n'));
