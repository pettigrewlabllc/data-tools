import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Json } from '../src/engine/json';

/** A Python with pandas, when FM_PYTHON points at one (as JR_PYTHON does for Join Receipt). */
export const PYTHON = process.env.FM_PYTHON;

export function runPython(code: string, records: Json[]): Json[] {
  const dir = mkdtempSync(join(tmpdir(), 'fm-py-'));
  const file = join(dir, 'transform.py');
  writeFileSync(file, code);
  const out = execFileSync(PYTHON!, [file], { input: JSON.stringify(records), maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.toString()) as Json[];
}
