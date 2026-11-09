import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plainRow, type Db } from '@data-tools/core';

/** In-memory DuckDB for tests, fixtures and the future CLI. */
export async function createNodeDb(): Promise<Db> {
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  const dir = mkdtempSync(join(tmpdir(), 'join-receipt-'));
  const paths = new Map<string, string>();
  return {
    async query(sql) {
      const reader = await conn.runAndReadAll(sql);
      return (reader.getRowObjectsJS() as Record<string, unknown>[]).map(plainRow);
    },
    async registerFile(name, bytes) {
      const safe = name.replace(/[^A-Za-z0-9._-]/g, '_');
      const p = join(dir, `${paths.size}-${safe}`);
      writeFileSync(p, bytes);
      paths.set(name, p);
    },
    resolve(name) {
      const p = paths.get(name);
      if (!p) throw new Error(`File not registered: ${name}`);
      return p;
    },
  };
}
