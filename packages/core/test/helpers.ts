import { createNodeDb } from '@data-tools/core-node';
import { loadFile, profileTable, type Db, type TableProfile } from '../src';

export const enc = (s: string) => new TextEncoder().encode(s);

/** Load several CSV strings into a fresh DB and profile them. */
export async function setup(files: Record<string, string>): Promise<{ db: Db; profiles: TableProfile[] }> {
  const db = await createNodeDb();
  const taken = new Set<string>();
  const profiles: TableProfile[] = [];
  for (const [file, text] of Object.entries(files)) {
    const r = await loadFile(db, file, enc(text), taken);
    if (!r.ok) throw new Error(r.error);
    profiles.push(await profileTable(db, r.name, r.file));
  }
  return { db, profiles };
}

export const csv = (header: string, rows: (string | number)[][]) => [header, ...rows.map((r) => r.join(','))].join('\n') + '\n';
