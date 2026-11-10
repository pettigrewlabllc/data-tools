import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const PKG = resolve(import.meta.dirname, '..');
export const FIX = resolve(PKG, '../../fixtures/determinism-profiler');
const bin = join(PKG, '.venv/bin');
export const JUPYTER = process.env.DP_JUPYTER ?? (existsSync(join(bin, 'jupyter')) ? join(bin, 'jupyter') : undefined);
export const DBT = process.env.DP_DBT ?? (existsSync(join(bin, 'dbt')) ? join(bin, 'dbt') : undefined);
