/// <reference lib="webworker" />
/** The engine runs here, off the main thread: loading, profiling, scoring and validation. */
import { acceptDrafts } from '../engine/ai/drafts';
import { buildPayload } from '../engine/ai/payload';
import { compileJsonata } from '../engine/emit-jsonata';
import { compilePython } from '../engine/emit-python';
import type { FieldMapping } from '../engine/grammar';
import { loadFiles, type Json } from '../engine/json';
import { profileRecords, type SourceProfile } from '../engine/profile';
import { recommend, scoreProposal, type FieldRec } from '../engine/recommend';
import { inferSchema, targetFromColumns, targetFromExample, targetFromSchema, type Loosen, type Target, type TargetKind } from '../engine/target';
import { validateMapping } from '../engine/validate';
import { parseJson } from '../engine/json';
import type { Req, Res } from './protocol';

let records: Json[] = [];
let profile: SourceProfile | null = null;
let target: Target | null = null;
let recs: FieldRec[] = [];

function buildTarget(kind: TargetKind, text: string, loosen: Loosen): Target {
  if (kind === 'schema') return targetFromSchema(text);
  if (kind === 'example') return targetFromExample(text, loosen);
  return targetFromColumns(text);
}

async function handle(req: Req): Promise<Res> {
  switch (req.type) {
    case 'load': {
      const r = loadFiles(req.files);
      records = r.records;
      profile = records.length ? profileRecords(records, r.bigIntPaths) : null;
      return { type: 'loaded', files: r.files.map((f) => ({ name: f.name, records: f.records.length, recordRoot: f.recordRoot })), errors: r.errors, records: records.length, bigIntPaths: r.bigIntPaths, paths: profile?.paths.length ?? 0, thin: profile?.thin ?? false };
    }
    case 'infer': {
      const { value } = parseJson(req.text.trim());
      return { type: 'inferred', schema: JSON.stringify(inferSchema(Array.isArray(value) ? value[0] : value, req.loosen), null, 2) };
    }
    case 'recommend': {
      if (!profile) throw new Error('Load some samples first.');
      target = buildTarget(req.kind, req.text, req.loosen);
      const r = await recommend(target, profile, records);
      recs = r.fields;
      return { type: 'recommended', target, recs, records: r.records, thin: r.thin, scoreWithoutRules: r.scoreWithoutRules, profile };
    }
    case 'score': {
      if (!profile || !target) throw new Error('Nothing to score yet.');
      const f = target.fields.find((x) => x.id === req.field)!;
      const c = await scoreProposal(target, f, { ...req.mapping, sourceContext: req.sourceContext } as FieldMapping, profile, records, ['your edit']);
      return { type: 'scored', field: req.field, candidate: { ...c, mapping: req.mapping } };
    }
    case 'validate': {
      if (!target) throw new Error('Nothing to validate yet.');
      const v = await validateMapping(target, req.mappings, records);
      return { type: 'validated', validation: { ...v, outputs: v.outputs.slice(0, 50) }, jsonata: compileJsonata(req.mappings), python: compilePython(req.mappings, req.header), mapped: v.outputs.filter((o) => o !== undefined) as Json[] };
    }
    case 'payload': {
      if (!profile || !target) throw new Error('Get a recommendation first.');
      return { type: 'payload', payload: buildPayload(target, profile, recs) };
    }
    case 'drafts': {
      if (!profile || !target) throw new Error('Get a recommendation first.');
      const res = await acceptDrafts(req.answer, target, profile, records, (arr) => req.arrays[arr] ?? null);
      return { type: 'drafts', result: res };
    }
  }
}

self.onmessage = async (e: MessageEvent<{ id: number; req: Req }>) => {
  try {
    const res = await handle(e.data.req);
    (self as unknown as Worker).postMessage({ id: e.data.id, res });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: e.data.id, error: (err as Error).message });
  }
};
