/**
 * Recommendations: for every target field, the candidate sources scored with their parts, the transforms rules
 * propose (F5), and a question instead of a guess when the call is close or can't be made from values (F6).
 * Every candidate is compiled to JSONata and run on the samples before it is scored or shown.
 */
import { compileJsonata } from './emit-jsonata';
import { epochSeconds, FORMAT_LABEL, type FormatClass } from './formats';
import type { FieldMapping, Path, Scalar, Source, Transform } from './grammar';
import { showPath } from './grammar';
import type { Json } from './json';
import { hasToken, nameSimilarity, tokens } from './names';
import type { PathProfile, SourceProfile } from './profile';
import { share } from './profile';
import { hasRules, valueChecker } from './rules';
import { runAll } from './run';
import type { Target, TargetField } from './target';

/** Fixed in the PRD before any fixture was scored (F6). Changing them is logged with before/after numbers. */
export const T = 60;
export const G = 10;
/** Below this, nothing fits (F8). */
export const NO_SOURCE = 35;
const SCORE_RECORDS = 200;

export interface ScorePart { name: 'name' | 'type' | 'evidence' | 'rules'; points: number; of: number; why: string }

export interface Candidate {
  /** Mapping relative to the field's context (the record, or an item of the parent array). */
  mapping: FieldMapping;
  sourceId: string;
  score: number;
  parts: ScorePart[];
  reason: string;
  /** Up to 5 sample pairs: the source value and what the mapping makes of it. */
  examples: { before: string; after: string }[];
  /** Records (or items) where the mapped value passes the target's rules, when it has any. */
  ruleFit?: { pass: number; of: number };
  flags: string[];
}

export type QuestionKind = 'close_call' | 'low_score' | 'unit' | 'epoch' | 'big_integer' | 'thin';

export interface QuestionOption { label: string; candidate: Candidate; samples: string[] }
export interface Question { kind: QuestionKind; text: string; options: QuestionOption[] }

export type Status = 'confident' | 'question' | 'no_source';

export interface FieldRec {
  field: TargetField;
  status: Status;
  candidates: Candidate[];
  /** The proposal when confident. Never set for a question or no source: nothing under the bar is pre-selected. */
  chosen: Candidate | null;
  question?: Question;
  note?: string;
  /** For fields inside a target array: the source array they were scored under. */
  sourceContext?: string;
}

export interface Recommendation { fields: FieldRec[]; records: number; thin: boolean; scoreWithoutRules: boolean }

// ---------- helpers

const show = (v: Json | undefined): string => (v === undefined ? '(missing)' : v === null ? 'null' : typeof v === 'string' ? v : JSON.stringify(v));
const isMoneyName = (p: Path) => hasToken(p, 'price', 'amount', 'total', 'cost', 'fee', 'subtotal', 'tax', 'balance', 'revenue', 'paid', 'charge', 'shipping', 'discount');
const isCentsName = (p: Path) => hasToken(p, 'cents', 'minor', 'pennies') || /cents|minor_?units?/i.test(p.join('.'));
const isTimeName = (p: Path) => hasToken(p, 'time', 'date', 'created', 'updated', 'modified', 'at', 'timestamp', 'when', 'ts', 'datetime', 'day', 'born', 'birthday', 'dob', 'expires', 'start', 'end');
const dateTarget = (f: TargetField) => f.format === 'date' || f.format === 'date-time';

function fieldsUnder(profile: SourceProfile, context: Path | null): PathProfile[] {
  const key = context ? JSON.stringify(context) : null;
  return profile.paths.filter((p) => (p.context ? JSON.stringify(p.context) : null) === key);
}

const presence = (p: PathProfile) => (p.total ? p.present / p.total : 0);

// ---------- transforms (F5)

interface Draft { source: Source; transforms: Transform[]; sourceId: string; name: number; nameWhy: string; flags: string[]; profile?: PathProfile }

function proposeTransforms(f: TargetField, p: PathProfile): { transforms: Transform[]; flags: string[] } {
  const ts: Transform[] = [];
  const flags: string[] = [];
  const want = f.kind === 'scalar_array' ? f.itemType : f.type;
  const strings = (p.types.string ?? 0) > 0;
  const nums = (p.types.integer ?? 0) + (p.types.number ?? 0) > 0;
  if (dateTarget(f) || (want === 'string' && isTimeName(f.path) && (p.format === 'epoch' || p.format === 'timestamp'))) {
    const out = f.format === 'date' ? 'date' : 'date-time';
    if (p.format === 'epoch' && p.epoch && (dateTarget(f) || isTimeName(f.path))) {
      ts.push({ op: 'parse_date', from: `epoch_${p.epoch}` as const, out });
      flags.push(`read as epoch ${p.epoch === 's' ? 'seconds' : p.epoch === 'ms' ? 'milliseconds' : p.epoch === 'us' ? 'microseconds' : 'nanoseconds'}`);
    } else if (p.format === 'timestamp' || p.format === 'date') {
      const us = p.values.some((v) => typeof v === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v));
      ts.push({ op: 'parse_date', from: us ? 'us_date' : 'iso', out });
    }
    return { transforms: ts, flags };
  }
  if (want === 'string' && !strings && (nums || (p.types.boolean ?? 0) > 0)) ts.push({ op: 'cast', to: 'string' });
  else if (want === 'integer' && strings && ['integer', 'year', 'integer_id'].includes(p.format) && !p.bigInt) ts.push({ op: 'cast', to: 'integer' });
  else if (want === 'number' && strings && (p.format === 'integer' || p.format === 'number')) ts.push({ op: 'cast', to: 'number' });
  else if (want === 'boolean' && (p.types.boolean ?? 0) < (p.present || 1)) ts.push({ op: 'cast', to: 'boolean' });
  if ((want === 'number' || want === 'integer' || !want) && isCentsName(p.path) && !isCentsName(f.path) && p.allInt && want !== 'integer') {
    ts.push({ op: 'scale', power: -2 });
    flags.push('cents to dollars, from the name');
  }
  if (want === 'string' && f.enum && f.enum.every((e) => typeof e === 'string')) {
    const enumLower = f.enum.every((e) => e === (e as string).toLowerCase());
    const enumUpper = f.enum.every((e) => e === (e as string).toUpperCase());
    const vals = p.values.filter((v): v is string => typeof v === 'string');
    if (enumLower && vals.some((v) => v !== v.toLowerCase()) && vals.every((v) => f.enum!.includes(v.toLowerCase().trim()))) ts.push({ op: 'trim' }, { op: 'lower' });
    else if (enumUpper && vals.some((v) => v !== v.toUpperCase()) && vals.every((v) => f.enum!.includes(v.toUpperCase().trim()))) ts.push({ op: 'trim' }, { op: 'upper' });
  }
  return { transforms: ts, flags };
}

// ---------- scoring

function typePart(f: TargetField, p: PathProfile | undefined, ts: Transform[], sourceOp: Source['op']): ScorePart | null {
  const want = f.kind === 'scalar_array' ? f.itemType : f.type;
  if (!want && !f.format) return null;
  if (sourceOp === 'count') return { name: 'type', points: want === 'integer' || want === 'number' ? 20 : 4, of: 20, why: 'a count is a whole number' };
  if (sourceOp === 'concat') return { name: 'type', points: want === 'string' ? 20 : 2, of: 20, why: 'joined text' };
  if (!p) return { name: 'type', points: 10, of: 20, why: 'no profile' };
  const t = p.types;
  const n = Math.max(1, p.present);
  const strs = (t.string ?? 0) / n, ints = (t.integer ?? 0) / n, num = ((t.integer ?? 0) + (t.number ?? 0)) / n, bools = (t.boolean ?? 0) / n;
  const cast = ts.some((x) => x.op === 'cast' || x.op === 'parse_date');
  let s = 0, why = '';
  if (dateTarget(f)) {
    s = ['timestamp', 'date', 'epoch'].includes(p.format) ? 1 : 0;
    why = s ? `${FORMAT_LABEL[p.format]} into a ${f.format}` : `${FORMAT_LABEL[p.format]} isn't a date or time`;
  } else if (want === 'string') {
    s = strs >= 0.9 ? 1 : p.format === 'integer_id' ? 0.85 : num >= 0.9 ? 0.55 : bools >= 0.9 ? 0.3 : strs;
    why = strs >= 0.9 ? 'text into text' : `${p.format === 'integer_id' ? 'a number ID' : 'numbers'} as text`;
  } else if (want === 'integer') {
    s = ints >= 0.9 ? 1 : ['integer', 'year', 'integer_id'].includes(p.format) && strs >= 0.9 ? 0.75 : num >= 0.9 ? 0.25 : 0;
    why = ints >= 0.9 ? 'whole numbers' : s ? 'numbers written as text' : 'not whole numbers';
    if (p.bigInt) { s = 0.3; why = 'integers too big for JavaScript, read as text'; }
  } else if (want === 'number') {
    s = num >= 0.9 ? 1 : (p.format === 'integer' || p.format === 'number') && strs >= 0.9 ? 0.75 : 0;
    why = num >= 0.9 ? 'numbers' : s ? 'numbers written as text' : 'not numbers';
  } else if (want === 'boolean') {
    s = bools >= 0.9 ? 1 : p.format === 'boolean' || (p.distinct <= 2 && p.values.every((v) => [0, 1, '0', '1', 'yes', 'no', 'true', 'false', 'Y', 'N', 'y', 'n'].includes(v as never))) ? 0.7 : 0;
    why = bools >= 0.9 ? 'true/false' : s ? 'yes/no values' : 'not true/false';
  } else { s = 0.5; why = 'no type to check'; }
  if (cast && s < 1) s = Math.min(1, s + 0.05);
  return { name: 'type', points: Math.round(20 * s), of: 20, why };
}

function evidencePart(f: TargetField, p: PathProfile | undefined, sourceOp: Source['op']): ScorePart & { strong?: boolean } {
  if (!p) return { name: 'evidence', points: 12, of: 20, why: sourceOp === 'count' ? 'counts the items' : 'built from several fields' };
  const pres = presence(p);
  const want: FormatClass[] | null =
    f.format === 'email' || hasToken(f.path, 'email') ? ['email'] :
    f.format === 'uri' || f.format === 'url' || hasToken(f.path, 'url', 'link', 'href', 'website') ? ['url'] :
    f.format === 'uuid' ? ['uuid'] :
    dateTarget(f) || isTimeName(f.path) ? ['date', 'timestamp', 'epoch'] :
    hasToken(f.path, 'zip', 'postal', 'postcode') ? ['zip5'] :
    hasToken(f.path, 'country') ? ['iso2', 'iso3', 'country_name'] :
    hasToken(f.path, 'state') && !hasToken(f.path, 'status') ? ['us_state_abbr', 'us_state_name', 'us_state_fips'] :
    null;
  let fit = 0.5, why = FORMAT_LABEL[p.format];
  if (want) {
    fit = want.includes(p.format) ? 1 : 0.05;
    why = want.includes(p.format) ? `values look like ${FORMAT_LABEL[p.format]}` : `values look like ${FORMAT_LABEL[p.format]}, not ${FORMAT_LABEL[want[0]]}`;
  } else if (hasToken(f.path, 'id', 'key', 'uuid', 'identifier', 'sku')) {
    fit = ['integer_id', 'text_id', 'uuid', 'integer'].includes(p.format) ? 1 : p.format === 'free_text' ? 0.05 : 0.4;
    why = `values look like ${FORMAT_LABEL[p.format]}`;
  } else if (f.enum) {
    const vals = p.values.map((v) => String(v).toLowerCase().trim());
    const en = f.enum.map((v) => String(v).toLowerCase());
    const hit = vals.length ? vals.filter((v) => en.includes(v)).length / vals.length : 0;
    fit = hit >= 0.9 ? 1 : 0.2 + 0.6 * hit;
    why = `${Math.round(hit * 100)}% of values are in the target's list`;
  } else if (p.format === 'free_text' && !hasToken(f.path, 'description', 'desc', 'summary', 'body', 'text', 'note', 'notes', 'comment', 'title', 'message', 'bio', 'place', 'address')) {
    fit = 0.35;
  }
  const pts = Math.round(20 * fit * (0.4 + 0.6 * pres));
  return { name: 'evidence', points: pts, of: 20, why: pres < 1 ? `${why}; present in ${share(p.present, p.total)}` : why, strong: !!want && fit === 1 };
}

function namePart(sim: number, why: string): ScorePart {
  const how = sim >= 0.95 ? 'Same name' : sim >= 0.7 ? 'Close name' : sim >= 0.4 ? 'Name partly matches' : 'Name barely matches';
  return { name: 'name', points: Math.round(40 * sim), of: 40, why: sim >= 0.95 && / and /.test(why) ? how : `${how} (${why})` };
}

// ---------- candidate generation

function draftsFor(f: TargetField, profile: SourceProfile, srcContext: Path | null): Draft[] {
  const pool = fieldsUnder(profile, srcContext);
  const drafts: Draft[] = [];
  const leafPath = f.path;
  if (f.kind === 'scalar') {
    for (const p of pool) {
      if (p.kind !== 'scalar') continue;
      const sim = nameSimilarity(leafPath, p.path);
      const { transforms, flags } = proposeTransforms(f, p);
      drafts.push({ source: { op: 'path', path: p.path }, transforms, sourceId: p.id, name: sim, nameWhy: `${showPath(f.path)} and ${showPath(p.path)}`, flags, profile: p });
    }
    // Split names: a full-name target and first/last source fields under one parent.
    if (hasToken(leafPath, 'name') && !hasToken(leafPath, 'first', 'last', 'given', 'family', 'sur', 'user', 'file', 'display')) {
      const nameLike = (p: PathProfile, ...w: string[]) => p.kind === 'scalar' && ['text', 'categorical', 'text_id'].includes(p.format) && (hasToken(p.path.slice(-1), 'name') || /^(first|given|fname|forename|last|family|surname|lname)$/i.test(p.path[p.path.length - 1])) && hasToken(p.path.slice(-1), ...w);
      const firsts = pool.filter((p) => nameLike(p, 'first', 'given', 'fname', 'forename'));
      for (const fp of firsts) {
        const parent = fp.path.slice(0, -1).join('.');
        const lp = pool.find((p) => p.path.slice(0, -1).join('.') === parent && nameLike(p, 'last', 'family', 'surname', 'lname'));
        if (!lp) continue;
        const ctxSim = parent ? nameSimilarity(leafPath, fp.path.slice(0, -1).concat(['name'])) : 0.85;
        drafts.push({ source: { op: 'concat', paths: [fp.path, lp.path], sep: ' ' }, transforms: [], sourceId: `${fp.id} + ${lp.id}`, name: Math.max(0.8, ctxSim), nameWhy: 'first and last name, joined', flags: ['joins two fields'] });
      }
    }
    // Counts: `item_count` ← count(items[]).
    if ((f.type === 'integer' || f.type === 'number' || !f.type) && hasToken(leafPath, 'count', 'num', 'number', 'n', 'total') ) {
      const rest = leafPath.flatMap(tokens).filter((t) => !['count', 'num', 'number', 'n', 'of', 'total'].includes(t));
      for (const p of pool.filter((x) => x.kind === 'object_array' || x.kind === 'scalar_array')) {
        const sim = rest.length ? nameSimilarity(rest, p.path) : 0.3;
        if (sim < 0.5) continue;
        drafts.push({ source: { op: 'count', array: p.path }, transforms: [], sourceId: `count(${p.id})`, name: 0.75 + 0.2 * sim, nameWhy: `number of ${showPath(p.path)}`, flags: ['counts items'] });
      }
    }
  } else if (f.kind === 'scalar_array') {
    for (const p of pool) {
      if (p.kind === 'scalar_array') {
        const tsP = proposeTransforms(f, p);
        drafts.push({ source: { op: 'values', array: p.path, field: [] }, transforms: tsP.transforms, sourceId: p.id, name: nameSimilarity(leafPath, p.path), nameWhy: `${showPath(f.path)} and ${showPath(p.path)}`, flags: tsP.flags, profile: p });
      }
    }
    // A list of one field from each item: `skus` ← items[].sku.
    if (!srcContext) for (const arr of pool.filter((p) => p.kind === 'object_array')) {
      for (const p of fieldsUnder(profile, arr.path).filter((x) => x.kind === 'scalar')) {
        const sim = Math.max(nameSimilarity(leafPath, p.path), nameSimilarity(leafPath, [...arr.path, ...p.path]) * 0.95);
        const tsP = proposeTransforms(f, p);
        drafts.push({ source: { op: 'values', array: arr.path, field: p.path }, transforms: tsP.transforms, sourceId: p.id, name: sim, nameWhy: `${showPath(f.path)} and ${p.id}`, flags: tsP.flags, profile: p });
      }
    }
  }
  return drafts;
}

/** Coalesce for "sometimes present" pairs: each misses some records, together they cover nearly all (≥ 10 records). */
function coalesceDrafts(f: TargetField, drafts: Draft[], records: number): Draft[] {
  if (records < 10) return [];
  const paths = drafts.filter((d) => d.source.op === 'path' && d.profile && d.name >= 0.5).sort((a, b) => b.name - a.name).slice(0, 3);
  const out: Draft[] = [];
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    const a = paths[i].profile!, b = paths[j].profile!;
    if (presence(a) >= 0.97 || presence(b) >= 0.97) continue;
    if (Math.min(1, presence(a) + presence(b)) < 0.97) continue;
    if (JSON.stringify(paths[i].transforms) !== JSON.stringify(paths[j].transforms)) continue;
    out.push({ source: { op: 'coalesce', paths: [a.path, b.path] }, transforms: paths[i].transforms, sourceId: `${a.id} or ${b.id}`, name: Math.max(paths[i].name, paths[j].name), nameWhy: 'each is present when the other is missing', flags: ['first of two fields'], profile: { ...a, present: Math.round(a.total * Math.min(1, presence(a) + presence(b))) } });
  }
  return out;
}

async function evaluate(f: TargetField, drafts: Draft[], items: Json[], withRules: boolean): Promise<Candidate[]> {
  if (!drafts.length) return [];
  // One compiled expression per field holds every candidate, so the samples are walked once.
  const keyed = drafts.map((d, i) => ({ target: [`c${i}`], source: d.source, transforms: d.transforms }));
  const outs = await runAll(compileJsonata(keyed), items);
  const check = withRules && hasRules(f) ? valueChecker(f) : null;
  return drafts.map((d, i) => {
    const vals = outs.map((o) => (o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, Json>)[`c${i}`] : undefined));
    const parts: ScorePart[] = [namePart(d.name, d.nameWhy)];
    const tp = typePart(f, d.profile, d.transforms, d.source.op);
    if (tp) parts.push(tp);
    const ev = evidencePart(f, d.profile, d.source.op);
    const strong = ev.strong;
    delete ev.strong;
    parts.push(ev);
    let ruleFit: Candidate['ruleFit'];
    if (check) {
      const relevant = vals.filter((v, j) => v !== undefined || f.required || !items[j]);
      let pass = 0;
      for (const v of vals) if (v === undefined ? !f.required : f.kind === 'scalar_array' ? Array.isArray(v) && v.every((x) => check(x)) : check(v)) pass++;
      ruleFit = { pass, of: vals.length };
      const present = vals.filter((v) => v !== undefined).length;
      // Rule fit only counts values the mapping produced; an all-missing mapping passes nothing.
      // Missing values pass an optional field's rules, so weigh by how often the mapping fills it at all.
      const passPresent = vals.filter((v) => v !== undefined && (f.kind === 'scalar_array' ? Array.isArray(v) && v.every((x) => check(x)) : check(v))).length;
      const s = present === 0 ? 0 : f.required ? pass / Math.max(1, vals.length) : (passPresent / present) * (0.5 + (0.5 * present) / Math.max(1, vals.length));
      parts.push({ name: 'rules', points: Math.round(20 * s), of: 20, why: `${share(pass, vals.length)} pass the target's rules${relevant.length < vals.length ? '' : ''}` });
    }
    const got = parts.reduce((n, p) => n + p.points, 0), of = parts.reduce((n, p) => n + p.of, 0);
    let score = Math.round((100 * got) / of);
    // A source whose name shares nothing with the target is only a candidate on strong value evidence (an
    // email-shaped column for an email field). Type and rule fit alone match any text column.
    if (d.name < 0.25 && !strong) score = Math.min(score, NO_SOURCE - 5);
    // A field that needs a format (email, URL, date) can't come from values that clearly aren't one.
    if (ev.points <= 1 && /not /.test(ev.why) && d.profile) score = Math.min(score, NO_SOURCE - 5);
    const examples: Candidate['examples'] = [];
    for (let j = 0; j < items.length && examples.length < 5; j++) {
      const before = d.source.op === 'path' ? getPath(items[j], d.source.path) : d.source.op === 'values' || d.source.op === 'count' || d.source.op === 'pick' ? getPath(items[j], d.source.array) : undefined;
      if (vals[j] === undefined && before === undefined) continue;
      examples.push({ before: d.source.op === 'concat' || d.source.op === 'coalesce' ? d.source.paths.map((p) => show(getPath(items[j], p))).join(' | ') : show(before), after: show(vals[j]) });
    }
    const reason = parts.slice().sort((a, b) => b.points / b.of - a.points / a.of)[0].why;
    return { mapping: { target: f.path, source: d.source, transforms: d.transforms }, sourceId: d.sourceId, score, parts, reason, examples, ruleFit, flags: d.flags };
  }).sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId));
}

function getPath(v: Json | undefined, p: Path): Json | undefined {
  let cur = v;
  for (const k of p) cur = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur[k] : undefined;
  return cur;
}

const optionSamples = (c: Candidate) => c.examples.map((e) => e.after).slice(0, 5);

// ---------- questions (F6)

function questionFor(f: TargetField, cands: Candidate[], profile: SourceProfile, items: Json[]): { status: Status; question?: Question; note?: string; chosen: Candidate | null } {
  const top = cands[0];
  if (!top || top.score < NO_SOURCE) return { status: 'no_source', chosen: null, note: `Nothing in the samples fits ${f.id}.` };
  const p = profile.paths.find((x) => x.id === top.sourceId);

  // Thin samples (F9): fewer than 3 distinct records, or every value the same.
  if (profile.thin || (p && p.present > 1 && p.distinct === 1 && top.mapping.source.op === 'path')) {
    top.score = Math.min(top.score, T - 1);
    const why = profile.thin ? `There are only ${profile.records} distinct records` : `Every value of ${p!.id} is the same`;
    return { status: 'question', chosen: null, question: { kind: 'thin', text: `${why}, so this can't be confirmed from the samples. Use ${top.sourceId} for ${f.id}?`, options: cands.slice(0, 3).map((c) => ({ label: c.sourceId, candidate: c, samples: optionSamples(c) })) } };
  }
  // Big integers into a number: precision would be lost.
  if (p?.bigInt && (f.type === 'integer' || f.type === 'number')) {
    const asText: Candidate = { ...top, mapping: { ...top.mapping, transforms: [{ op: 'cast', to: 'string' }] }, flags: [...top.flags, 'kept as text'] };
    return { status: 'question', chosen: null, question: { kind: 'big_integer', text: `${p.id} holds integers too big for JavaScript to keep exactly (above 2^53). ${f.id} wants a number. Keep them as text instead?`, options: [{ label: 'Keep as text (exact)', candidate: asText, samples: p.values.slice(0, 5).map(String) }] } };
  }
  // Close calls and low scores.
  const second = cands[1];
  if (top.score < T || (second && top.score - second.score < G)) {
    const close = second && top.score - second.score < G;
    const opts = cands.slice(0, close ? Math.min(3, cands.filter((c) => top.score - c.score < G).length) : 3);
    const text = close
      ? `Which one is ${f.id}? ${opts.length > 2 ? opts.slice(0, -1).map((o) => o.sourceId).join(', ') + ' and ' + opts[opts.length - 1].sourceId : opts.map((o) => o.sourceId).join(' and ')} score within ${G} points of each other.`
      : `The best match for ${f.id} scores ${top.score}, under ${T}. Is it one of these?`;
    return { status: 'question', chosen: null, question: { kind: close ? 'close_call' : 'low_score', text, options: opts.map((c) => ({ label: c.sourceId, candidate: c, samples: optionSamples(c) })) } };
  }
  // Units: cents or dollars can't be told from values (F5).
  if ((f.type === 'number' || (!f.type && isMoneyName(f.path))) && isMoneyName(f.path) && p && p.allInt && !top.mapping.transforms.some((t) => t.op === 'scale') && !isCentsName(f.path)) {
    const dollars = top;
    const cents: Candidate = { ...top, mapping: { ...top.mapping, transforms: [...top.mapping.transforms, { op: 'scale', power: -2 }] }, flags: [...top.flags, 'cents to dollars'] };
    const vals = p.values.filter((v) => typeof v === 'number' || typeof v === 'string').slice(0, 5);
    return { status: 'question', chosen: null, question: { kind: 'unit', text: `Is ${p.id} in dollars or cents? Every value is a whole number, so the values can't tell.`, options: [
      { label: 'Dollars (as is)', candidate: dollars, samples: vals.map((v) => String(v)) },
      { label: 'Cents (divide by 100)', candidate: cents, samples: vals.map((v) => String(Number(v) / 100)) },
    ] } };
  }
  // Epochs: a reading outside 1990–2040.
  const pd = top.mapping.transforms.find((t) => t.op === 'parse_date');
  if (pd && pd.op === 'parse_date' && pd.from.startsWith('epoch') && p) {
    const unit = pd.from.slice(6) as 's' | 'ms' | 'us' | 'ns';
    const years = p.values.map((v) => new Date(epochSeconds(v, unit) * 1000).getUTCFullYear());
    if (years.some((y) => y < 1990 || y > 2040)) {
      const units = ['s', 'ms', 'us', 'ns'] as const;
      const opts = units.map((u) => ({ label: u === 's' ? 'Seconds' : u === 'ms' ? 'Milliseconds' : u === 'us' ? 'Microseconds' : 'Nanoseconds', candidate: { ...top, mapping: { ...top.mapping, transforms: top.mapping.transforms.map((t) => (t === pd ? { ...pd, from: `epoch_${u}` as const } : t)) } }, samples: p.values.slice(0, 5).map((v) => new Date(epochSeconds(v, u) * 1000).toISOString()) }));
      return { status: 'question', chosen: null, question: { kind: 'epoch', text: `Is ${p.id} in seconds or milliseconds? Some readings land before 1990 or after 2040, which usually means the unit is wrong.`, options: opts } };
    }
  }
  void items;
  return { status: 'confident', chosen: top };
}

// ---------- the whole target

export async function recommend(target: Target, profile: SourceProfile, records: Json[]): Promise<Recommendation> {
  const sample = records.slice(0, SCORE_RECORDS);
  const withRules = target.kind !== 'columns';
  const out: FieldRec[] = [];

  for (const f of target.fields.filter((x) => x.context === null)) {
    if (f.kind === 'object_array') { out.push(...(await recommendArray(target, f, profile, sample, withRules))); continue; }
    const drafts = draftsFor(f, profile, null);
    drafts.push(...coalesceDrafts(f, drafts, profile.records));
    const cands = (await evaluate(f, prefilter(f, drafts), sample, withRules)).slice(0, 6);
    out.push({ field: f, candidates: cands, ...questionFor(f, cands, profile, sample) });
  }
  return { fields: out, records: profile.records, thin: profile.thin, scoreWithoutRules: !withRules };
}

/** Keep the plausible drafts before running them: the 12 best by name, plus any whose values have the format the field needs. */
function prefilter(f: TargetField, drafts: Draft[]): Draft[] {
  const sorted = drafts.slice().sort((a, b) => b.name - a.name);
  const keep = sorted.slice(0, 12);
  for (const d of sorted.slice(12)) if (d.profile && evidencePart(f, d.profile, d.source.op).strong) keep.push(d);
  return keep;
}

async function recommendArray(target: Target, f: TargetField, profile: SourceProfile, sample: Json[], withRules: boolean): Promise<FieldRec[]> {
  const children = target.fields.filter((x) => x.context && x.context.join('.') === f.path.join('.'));
  const arrays = profile.paths.filter((p) => p.context === null && p.kind === 'object_array');
  const scored: { arr: PathProfile; cand: Candidate; kids: FieldRec[] }[] = [];
  for (const arr of arrays) {
    const items = sample.flatMap((r) => { const v = getPath(r, arr.path); return Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []; }).slice(0, SCORE_RECORDS);
    const kids: FieldRec[] = [];
    for (const c of children) {
      const drafts = draftsFor(c, profile, arr.path);
      const cands = (await evaluate(c, prefilter(c, drafts), items, withRules)).slice(0, 6);
      const sub: SourceProfile = { ...profile, paths: profile.paths };
      kids.push({ field: c, candidates: cands, sourceContext: arr.id, ...questionFor(c, cands, sub, items) });
    }
    const fit = kids.length ? kids.reduce((n, k) => n + (k.candidates[0]?.score ?? 0), 0) / kids.length / 100 : 0.5;
    const sim = nameSimilarity(f.path, arr.path);
    const parts: ScorePart[] = [namePart(sim, `${showPath(f.path)} and ${showPath(arr.path)}`), { name: 'evidence', points: Math.round(60 * fit), of: 60, why: `its items fill the child fields at an average of ${Math.round(fit * 100)}` }];
    const score = Math.round((100 * parts.reduce((n, p) => n + p.points, 0)) / 100);
    const mapping: FieldMapping = { target: f.path, source: { op: 'nested', array: arr.path, fields: kids.map((k) => (k.chosen ?? k.candidates[0])?.mapping).filter((m): m is FieldMapping => !!m) }, transforms: [] };
    scored.push({ arr, kids, cand: { mapping, sourceId: arr.id, score, parts, reason: parts[1].why, examples: [{ before: `${share(arr.present, arr.total)} records have ${arr.id}`, after: `${arr.items ?? 0} items` }], flags: [] } });
  }
  scored.sort((a, b) => b.cand.score - a.cand.score);
  const cands = scored.map((s) => s.cand);
  const head: FieldRec = { field: f, candidates: cands, ...questionFor(f, cands, { ...profile, thin: profile.thin }, sample) };
  if (head.status === 'confident' || head.status === 'question') {
    const best = scored[0];
    return [head, ...best.kids];
  }
  return [head, ...children.map((c) => ({ field: c, status: 'no_source' as Status, candidates: [], chosen: null, note: `No array in the samples fills ${f.id}.` }))];
}

/** Final mappings from what the person approved, in target order. Questions and no-source fields are left out. */
export function approvedMappings(recs: FieldRec[], decisions: Map<string, Candidate | null>): FieldMapping[] {
  const out: FieldMapping[] = [];
  for (const r of recs) {
    if (r.field.context) continue;
    const pick = decisions.has(r.field.id) ? decisions.get(r.field.id) : r.chosen;
    if (!pick) continue;
    if (r.field.kind === 'object_array' && pick.mapping.source.op === 'nested') {
      const kids = recs.filter((k) => k.field.context && k.field.context.join('.') === r.field.path.join('.'));
      const fields = kids.map((k) => (decisions.has(k.field.id) ? decisions.get(k.field.id) : k.chosen)?.mapping).filter((m): m is FieldMapping => !!m);
      if (fields.length) out.push({ ...pick.mapping, source: { ...pick.mapping.source, fields } });
      continue;
    }
    out.push(pick.mapping);
  }
  return out;
}

export type { Scalar };

/**
 * Score a mapping someone else proposed (a person's edit, a model's draft) exactly as the rules score their own:
 * compiled, run on the samples, and checked against the target before it is shown.
 */
export async function scoreProposal(target: Target, f: TargetField, mapping: FieldMapping, profile: SourceProfile, records: Json[], flags: string[] = []): Promise<Candidate> {
  const s = mapping.source;
  const srcCtx = f.context ? (mapping as FieldMapping & { sourceContext?: Path }).sourceContext ?? null : null;
  const firstPath: Path | null = s.op === 'path' ? s.path : s.op === 'coalesce' || s.op === 'concat' ? s.paths[0] : s.op === 'values' ? [...s.array, ...s.field] : s.op === 'pick' ? [...s.array, ...s.field] : s.op === 'count' || s.op === 'nested' ? s.array : null;
  const pf = s.op === 'path' ? profile.paths.find((p) => JSON.stringify(p.path) === JSON.stringify(s.path) && JSON.stringify(p.context) === JSON.stringify(srcCtx)) : undefined;
  const id = s.op === 'path' ? (pf?.id ?? showPath(s.path)) : s.op === 'concat' ? s.paths.map(showPath).join(' + ') : s.op === 'coalesce' ? s.paths.map(showPath).join(' or ') : s.op === 'count' ? `count(${showPath(s.array)}[])` : s.op === 'constant' ? `constant ${JSON.stringify(s.value)}` : s.op === 'values' ? `${showPath(s.array)}[]${s.field.length ? '.' + showPath(s.field) : ''}` : s.op === 'pick' ? `${showPath(s.array)}[${typeof s.which === 'string' ? s.which : `${showPath(s.which.key)}=${JSON.stringify(s.which.equals)}`}].${showPath(s.field)}` : `${showPath(s.array)}[]`;
  const draft: Draft = { source: s, transforms: mapping.transforms, sourceId: id, name: firstPath ? nameSimilarity(f.path, firstPath) : 0.5, nameWhy: firstPath ? `${showPath(f.path)} and ${showPath(firstPath)}` : 'a fixed value', flags, profile: pf };
  const items = srcCtx ? records.flatMap((r) => { const v = getPath(r, srcCtx); return Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []; }) : records;
  const [c] = await evaluate(f, [draft], items.slice(0, SCORE_RECORDS), target.kind !== 'columns');
  return c;
}
