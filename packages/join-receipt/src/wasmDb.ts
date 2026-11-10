import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { plainRow, type Db } from '@data-tools/core';

export interface WasmDb extends Db {
  /** Run a COPY ... TO statement and hand back the file's bytes. */
  exportFile(name: string, copySql: string): Promise<Uint8Array>;
}

/** DuckDB in the browser. Everything runs in a worker on this machine; files never leave it. */
export async function createWasmDb(): Promise<WasmDb> {
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  });
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } });
  const conn = await db.connect();
  let serial = 0;
  return {
    async query(sql) {
      const table = await conn.query(sql);
      return table.toArray().map((r) => plainRow(r.toJSON() as Record<string, unknown>));
    },
    async registerFile(name, bytes) {
      await db.registerFileBuffer(name, bytes);
    },
    resolve(name) {
      return name;
    },
    async exportFile(name, copySql) {
      const file = `out-${serial++}-${name}`;
      await conn.query(copySql.replace('__OUT__', file.replace(/'/g, "''")));
      const buf = await db.copyFileToBuffer(file);
      await db.dropFile(file);
      return buf;
    },
  };
}
