import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TASKS } from '../fixtures/tasks';
import { targetFor } from '../fixtures/accuracy';
import { loadText } from '../src/engine/json';
import { profileRecords } from '../src/engine/profile';
import { approvedMappings, recommend } from '../src/engine/recommend';
import { compileJsonata } from '../src/engine/emit-jsonata';
import { compilePython } from '../src/engine/emit-python';
import { runAll } from '../src/engine/run';
import { firstDifference } from '../src/engine/canonical';
import { fieldValuesAgree } from '../src/engine/validate';
import { PYTHON, runPython } from './helpers';

const load = (t: (typeof TASKS)[number]) => loadText(t.sample, readFileSync(join(import.meta.dirname, '..', 'fixtures', 'samples', t.sample), 'utf8'), t.recordRoot);

// Every fixture's mapping: the top candidate for every field, answered or not, so the emitters see every op the
// scorer produces on real payloads.
async function fixtureMapping(t: (typeof TASKS)[number]) {
  const file = load(t);
  const r = await recommend(targetFor(t, 'schema'), profileRecords(file.records, file.bigIntPaths), file.records);
  const decisions = new Map(r.fields.map((f) => [f.field.id, f.chosen ?? f.candidates[0] ?? null]));
  return { file, mappings: approvedMappings(r.fields, decisions) };
}

describe('every fixture', () => {
  for (const t of TASKS) {
    it(`${t.id}: per-field values agree with the full transform`, async () => {
      const { file, mappings } = await fixtureMapping(t);
      expect(mappings.length).toBeGreaterThan(0);
      expect(await fieldValuesAgree(mappings, file.records)).toEqual({ ok: true });
    });
    it.skipIf(!PYTHON)(`${t.id}: Python output equals JSONata output in canonical form`, async () => {
      const { file, mappings } = await fixtureMapping(t);
      const js = (await runAll(compileJsonata(mappings), file.records)).filter((x) => x !== undefined);
      const py = runPython(compilePython(mappings), file.records);
      expect(py.length).toBe(js.length);
      js.forEach((x, i) => expect(firstDifference(x, py[i]), `record ${i}`).toBeNull());
    });
  }
});
