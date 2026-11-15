import { describe, it, expect } from 'vitest';
import { measureUniqueness, findRiskySubsets, createView, optionsFor, applyToFacts, virtualSelect, checkCollection, draftPolicy, plannedNoticeCategories, type ColumnFact } from '../src';
import { setup, csv } from './helpers';

// Hand-computed reference (rows 1-6): zip, dob_year, sex
//  1 94110 1980 F | 2 94110 1980 F | 3 94110 1975 M | 4 10001 1980 F | 5 10001 1990 M | 6 10001 1990 M
//  all three: rows 3 and 4 are alone -> 2 of 6.  zip alone: 0.  dob_year alone: row 3 -> 1.  sex alone: 0.
//  zip+sex: rows 3 and 4 -> 2.  zip+dob_year: rows 3 and 4 -> 2.  dob_year+sex: row 3 -> 1.
const PEOPLE = csv('id,zip,dob_year,sex', [[1, '94110', 1980, 'F'], [2, '94110', 1980, 'F'], [3, '94110', 1975, 'M'], [4, '10001', 1980, 'F'], [5, '10001', 1990, 'M'], [6, '10001', 1990, 'M']]);

describe('uniqueness', () => {
  it('matches the hand-computed reference', async () => {
    const { db } = await setup({ 'people.csv': PEOPLE });
    const one = async (qi: string[]) => (await measureUniqueness(db, 'people', qi)).unique;
    expect(await one(['zip', 'dob_year', 'sex'])).toBe(2);
    expect(await one(['zip'])).toBe(0);
    expect(await one(['dob_year'])).toBe(1);
    expect(await one(['sex'])).toBe(0);
    expect(await one(['zip', 'sex'])).toBe(2);
    expect(await one(['zip', 'dob_year'])).toBe(2);
    expect(await one(['dob_year', 'sex'])).toBe(1);
    const all = await measureUniqueness(db, 'people', ['zip', 'dob_year', 'sex']);
    expect(all).toMatchObject({ total: 6, unique: 2 });
    expect(all.share).toBeCloseTo(1 / 3, 10);
  });
  it('finds the smallest column sets, skipping supersets', async () => {
    const { db } = await setup({ 'people.csv': PEOPLE });
    const s = await findRiskySubsets(db, 'people', ['zip', 'dob_year', 'sex'], undefined, 0.3, 3);
    expect(s.map((x) => x.columns)).toEqual([['zip', 'dob_year'], ['zip', 'sex']]);
    expect(s.every((x) => Math.abs(x.share - 1 / 3) < 1e-9)).toBe(true);
    expect(await findRiskySubsets(db, 'people', ['zip', 'sex'], undefined, 0.9, 3)).toEqual([]);
  });
  it('counts entities, not rows, when there is an entity column', async () => {
    // a has two rows with the same zip (one tuple, only a has it); b and c share a zip.
    const { db } = await setup({ 'ev.csv': csv('user,zip', [['a', 1], ['a', 1], ['b', 2], ['c', 2]]) });
    expect(await measureUniqueness(db, 'ev', ['zip'], 'user')).toMatchObject({ total: 3, unique: 1 });
    expect(await measureUniqueness(db, 'ev', ['zip'])).toMatchObject({ total: 4, unique: 0 });
  });
  it('an entity that shares any of its values with another is not unique; empty cells match each other', async () => {
    const { db } = await setup({ 'ev.csv': csv('user,zip', [['a', 1], ['a', 2], ['b', 2], ['c', ''], ['d', '']]) });
    expect(await measureUniqueness(db, 'ev', ['zip'], 'user')).toMatchObject({ total: 4, unique: 0 });
  });
});

describe('options recompute the finding without touching the data', () => {
  const facts: ColumnFact[] = [
    { table: 'people', column: 'zip', category: 'user.contact.address.postal_code', confidence: 0.9, confirmed: true },
    { table: 'people', column: 'dob_year', category: 'user.demographic.age_range', confidence: 0.9, confirmed: true },
    { table: 'people', column: 'lat', category: 'user.location.precise', confidence: 0.9, confirmed: true },
  ];
  const policy = draftPolicy('We collect your approximate location and your age range.');
  it('offers hashing only for direct identifiers, and labels it', () => {
    expect(optionsFor('user.contact.email').map((o) => o.id)).toContain('hash');
    expect(optionsFor('user.contact.email').find((o) => o.id === 'hash')!.note).toBe('pseudonymises');
    expect(optionsFor('user.contact.address.postal_code').map((o) => o.id)).not.toContain('hash');
  });
  it('generalising precise location makes the finding disclosed; dropping removes it', () => {
    expect(checkCollection(facts, policy).find((f) => f.column === 'lat')!.cls).toBe('contradicted');
    const gen = applyToFacts(facts, { 'people.lat': 'generalise' });
    expect(checkCollection(gen, policy).find((f) => f.column === 'lat')).toMatchObject({ category: 'user.location.imprecise', cls: 'disclosed' });
    expect(applyToFacts(facts, { 'people.lat': 'drop' }).some((f) => f.column === 'lat')).toBe(false);
  });
  it('update-notice plans a notice line', () => {
    expect(plannedNoticeCategories(facts, { 'people.zip': 'update_notice' })).toEqual(['user.contact.address.postal_code']);
  });
  it('generalising ZIP to 3 digits raises the share of people in groups; the file is unchanged', async () => {
    const { db } = await setup({ 'people.csv': PEOPLE });
    const cols = [{ name: 'id' }, { name: 'zip' }, { name: 'dob_year' }, { name: 'sex' }];
    const zfacts: ColumnFact[] = [{ table: 'people', column: 'zip', category: 'user.contact.address.postal_code', confidence: 1, confirmed: true }];
    await createView(db, 'people_v', virtualSelect('people', cols, zfacts, { 'people.zip': 'generalise' }));
    const [r] = await db.query(`SELECT zip FROM people_v WHERE id = 1`);
    expect(r.zip).toBe('941');
    const [orig] = await db.query(`SELECT zip FROM people WHERE id = 1`);
    expect(String(orig.zip)).toBe('94110'); // the user's table is untouched
    // ZIP prefixes 941 and 100: zip+sex is now {941,F}x2, {941,M}x1, {100,F}x1, {100,M}x2, same as before here, so still 2 unique
    expect((await measureUniqueness(db, 'people_v', ['zip', 'sex'])).unique).toBe(2);
    expect((await measureUniqueness(db, 'people_v', ['zip', 'dob_year', 'sex'])).unique).toBe(2);
  });
  it('dropping a column removes it from the view; hashing keeps uniqueness', async () => {
    const { db } = await setup({ 'p.csv': csv('email,zip', [['a@x.com', 1], ['b@x.com', 1]]) });
    const cols = [{ name: 'email' }, { name: 'zip' }];
    const f: ColumnFact[] = [{ table: 'p', column: 'email', category: 'user.contact.email', confidence: 1, confirmed: true }];
    await createView(db, 'p_drop', virtualSelect('p', cols, f, { 'p.email': 'drop' }));
    expect((await db.query(`DESCRIBE p_drop`)).map((r) => r.column_name)).toEqual(['zip']);
    await createView(db, 'p_hash', virtualSelect('p', cols, f, { 'p.email': 'hash' }));
    expect((await measureUniqueness(db, 'p_hash', ['email'])).unique).toBe(2);
    const [h] = await db.query(`SELECT email FROM p_hash LIMIT 1`);
    expect(String(h.email)).toMatch(/^[0-9a-f]{32}$/);
  });
  it('suppressing rare values blanks values fewer than 5 rows share', async () => {
    const rows = [...Array(5)].map(() => ['A']).concat([['B']]);
    const { db } = await setup({ 'q.csv': csv('town', rows) });
    const f: ColumnFact[] = [{ table: 'q', column: 'town', category: 'user.contact.address.city', confidence: 1, confirmed: true }];
    await createView(db, 'q_v', virtualSelect('q', [{ name: 'town' }], f, { 'q.town': 'suppress_rare' }));
    const r = await db.query(`SELECT town, count(*) AS n FROM q_v GROUP BY 1 ORDER BY 2 DESC`);
    expect(r.map((x) => [x.town, x.n])).toEqual([['A', 5], [null, 1]]);
  });
});
