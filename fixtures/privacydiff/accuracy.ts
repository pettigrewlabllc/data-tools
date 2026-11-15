/**
 * Scores PrivacyDiff on its labelled fixtures and writes accuracy.json. The README quotes only what this file says.
 *  1. columns.tsv: column classification, direct-identifier recall (target 0.9).
 *  2. scenarios/*: a notice plus table definitions with planted findings; precision of "not disclosed" (target 0.9).
 * Output is deterministic so CI can `git diff --exit-code` it. Run: npm run accuracy:privacydiff
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyPersonal, needsConfirming, getCategory, parseDdl, draftPolicy, checkCollection, type FindingClass, type ColumnFact } from '@data-tools/core';

const HERE = dirname(fileURLToPath(import.meta.url));

export const ALIAS: Record<string, string> = {
  EM: 'user.contact.email', PH: 'user.contact.phone_number', NM: 'user.name', ST: 'user.contact.address.street', CT: 'user.contact.address.city',
  SA: 'user.contact.address.state', ZP: 'user.contact.address.postal_code', CO: 'user.contact.address.country', UR: 'user.contact.url',
  LP: 'user.location.precise', LI: 'user.location.imprecise', IP: 'user.device.ip_address', DV: 'user.device.device_id', CK: 'user.device.cookie_id',
  UID: 'user.unique_id', VH: 'user.vehicle_id', CR: 'user.credentials', SSN: 'user.government_id.national_identification_number',
  DL: 'user.government_id.drivers_license_number', PP: 'user.government_id.passport_number', GID: 'user.government_id', FIN: 'user.financial',
  BK: 'user.financial.bank_account', DOB: 'user.demographic.date_of_birth', AGE: 'user.demographic.age_range', GEN: 'user.demographic.gender',
  RACE: 'user.demographic.race_ethnicity', ORI: 'user.sexual_orientation', REL: 'user.religious_belief', POL: 'user.political_opinion',
  UN: 'user.union_membership', HLT: 'user.health_and_medical', MRN: 'user.health_and_medical.record_number', INS: 'user.health_and_medical.insurance_id',
  BIO: 'user.biometric', GENE: 'user.genetic', IMG: 'user.image', CHD: 'user.childrens', WK: 'user.workplace', BEH: 'user.behavior', MSG: 'user.content.message',
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const ratio = (a: number, b: number) => (b === 0 ? 1 : r3(a / b));

// ---------- 1. classification ----------
interface Row { table: string; column: string; type: string; label: string | null; samples?: string[] }
const rows: Row[] = readFileSync(join(HERE, 'columns.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
  const [table, column, type, label, samples] = l.split('|');
  if (label !== '-' && !ALIAS[label]) throw new Error(`unknown label ${label} for ${table}.${column}`);
  return { table, column, type, label: label === '-' ? null : ALIAS[label], samples: samples ? samples.split(';') : undefined };
});

function score(withValues: boolean) {
  let direct = 0, directHit = 0, directConfident = 0, personal = 0, personalHit = 0, predicted = 0, predictedRight = 0, falsePersonal = 0, negatives = 0;
  const misses: string[] = [];
  for (const r of rows) {
    const c = classifyPersonal({ name: r.column, type: r.type, table: r.table, ...(withValues && r.samples ? { samples: r.samples } : {}) });
    if (r.label === null) { negatives++; if (c.category !== null) { falsePersonal++; misses.push(`${r.table}.${r.column}: expected none, got ${c.category} (${c.confidence})`); } continue; }
    personal++;
    const hit = c.category === r.label;
    if (hit) personalHit++;
    if (c.category) { predicted++; if (hit) predictedRight++; }
    if (getCategory(r.label).kind === 'direct') {
      direct++;
      if (hit) { directHit++; if (!needsConfirming(c)) directConfident++; }
      else misses.push(`${r.table}.${r.column}: expected ${r.label}, got ${c.category ?? 'none'} (${c.confidence})`);
    } else if (!hit) misses.push(`${r.table}.${r.column}: expected ${r.label}, got ${c.category ?? 'none'} (${c.confidence})`);
  }
  return {
    columns: rows.length, personalColumns: personal, directIdentifierColumns: direct,
    directIdentifierRecall: ratio(directHit, direct), directIdentifierRecallConfident: ratio(directConfident, direct),
    allPersonalRecall: ratio(personalHit, personal), proposalPrecision: ratio(predictedRight, predicted),
    notPersonalColumns: negatives, notPersonalFlagged: falsePersonal,
    misses: misses.sort(),
  };
}

// ---------- 2. scenarios ----------
interface Label { category: string; cls: FindingClass }
const scenarioDir = join(HERE, 'scenarios');
const classes: FindingClass[] = ['disclosed', 'vague', 'not_disclosed', 'contradicted'];
const confusion: Record<string, Record<string, number>> = {};
for (const a of classes) { confusion[a] = {}; for (const b of classes) confusion[a][b] = 0; }
let predND = 0, predNDRight = 0, wantND = 0, wantNDFound = 0, provisionalSkipped = 0, total = 0, right = 0;
const scenarioMisses: string[] = [];
const scenarios: string[] = existsSync(scenarioDir) ? readdirSync(scenarioDir).sort() : [];
for (const id of scenarios) {
  const dir = join(scenarioDir, id);
  const policy = draftPolicy(readFileSync(join(dir, 'notice.txt'), 'utf8'));
  const labels: Record<string, Label> = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8'));
  const facts: ColumnFact[] = [];
  for (const t of parseDdl(readFileSync(join(dir, 'schema.sql'), 'utf8'))) {
    for (const col of t.columns) {
      const c = classifyPersonal({ name: col.name, type: col.type, table: t.name });
      if (c.category) facts.push({ table: t.name, column: col.name, type: col.type, category: c.category, confidence: c.confidence, confirmed: false });
    }
  }
  const findings = checkCollection(facts, policy);
  for (const [key, want] of Object.entries(labels)) {
    const f = findings.find((x) => `${x.table}.${x.column}` === key);
    total++;
    if (want.cls === 'not_disclosed') wantND++;
    const got = f && !f.provisional ? f.cls : null;
    if (f && f.provisional) provisionalSkipped++;
    if (got === want.cls) right++;
    else scenarioMisses.push(`${id}/${key}: expected ${want.cls} (${want.category}), got ${got ?? (f ? `provisional ${f.cls}` : 'no category')} (${f?.category ?? '-'})`);
    if (got) confusion[want.cls][got]++;
    if (want.cls === 'not_disclosed' && got === 'not_disclosed') wantNDFound++;
  }
  // Every "not disclosed" the tool reports on a column the fixture knows about, and on columns it does not label at all.
  for (const f of findings) {
    if (f.provisional || f.cls !== 'not_disclosed') continue;
    predND++;
    const want = labels[`${f.table}.${f.column}`];
    if (want?.cls === 'not_disclosed') predNDRight++;
    else scenarioMisses.push(`${id}/${f.table}.${f.column}: reported not_disclosed, fixture says ${want ? want.cls : 'not personal'}`);
  }
}

const out = {
  classification: { namesOnly: score(false), withValues: score(true) },
  collection: {
    scenarios: scenarios.length, labelledColumns: total, correctClass: ratio(right, total),
    notDisclosedPrecision: ratio(predNDRight, predND), notDisclosedRecall: ratio(wantNDFound, wantND),
    notDisclosedReported: predND, notDisclosedCorrect: predNDRight, provisionalSkipped,
    confusion, misses: scenarioMisses.sort(),
  },
  targets: { directIdentifierRecall: 0.9, notDisclosedPrecision: 0.9 },
};
writeFileSync(join(HERE, 'accuracy.json'), JSON.stringify(out, null, 2) + '\n');
const c = out.classification;
console.log(`direct-identifier recall: names only ${c.namesOnly.directIdentifierRecall}, with values ${c.withValues.directIdentifierRecall} (target 0.9)`);
console.log(`personal-column recall: ${c.namesOnly.allPersonalRecall}; flagged by mistake: ${c.namesOnly.notPersonalFlagged} of ${c.namesOnly.notPersonalColumns}`);
console.log(`not-disclosed precision: ${out.collection.notDisclosedPrecision} (${predNDRight}/${predND}), recall ${out.collection.notDisclosedRecall}; class accuracy ${out.collection.correctClass}`);
