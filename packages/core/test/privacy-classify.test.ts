import { describe, it, expect } from 'vitest';
import { classifyPersonal, needsConfirming, tokenize, luhn, parseDdl } from '../src';

const cat = (name: string, extra: Partial<Parameters<typeof classifyPersonal>[0]> = {}) => classifyPersonal({ name, ...extra }).category;

describe('tokenize', () => {
  it('splits snake, camel, kebab and digits', () => {
    expect(tokenize('first_name')).toEqual(['first', 'name']);
    expect(tokenize('EmailAddress')).toEqual(['email', 'address']);
    expect(tokenize('cust-IPAddr2')).toEqual(['cust', 'ip', 'addr', '2']);
  });
});

describe('classifyPersonal, names only (DDL mode)', () => {
  it.each([
    ['email', 'user.contact.email'], ['cust_email_addr', 'user.contact.email'], ['dob', 'user.demographic.date_of_birth'],
    ['zip', 'user.contact.address.postal_code'], ['ssn', 'user.government_id.national_identification_number'],
    ['lat', 'user.location.precise'], ['lng', 'user.location.precise'], ['ip_address', 'user.device.ip_address'],
    ['userId', 'user.unique_id'], ['mrn', 'user.health_and_medical.record_number'], ['under_13', 'user.childrens'],
    ['approx_lat', 'user.location.imprecise'], ['diagnosis', 'user.health_and_medical'],
  ])('%s → %s', (name, want) => expect(cat(name)).toBe(want));
  it('leaves ordinary columns alone', () => {
    for (const n of ['order_id', 'created_at', 'sku', 'price', 'status', 'id']) expect(cat(n), n).toBeNull();
  });
  it('a word like opt_in or count says the column is about the data, not the data', () => {
    expect(cat('email_opt_in', { type: 'BOOLEAN' })).toBeNull();
    expect(cat('email_sent_count')).toBeNull();
  });
  it('a bare name is only a guess, and needs confirming', () => {
    const c = classifyPersonal({ name: 'name' });
    expect(c.category).toBe('user.name');
    expect(needsConfirming(c)).toBe(true);
    expect(needsConfirming(classifyPersonal({ name: 'name', table: 'patients' }))).toBe(false);
    expect(classifyPersonal({ name: 'name', table: 'products' }).category).toBeNull();
  });
  it('explains itself', () => {
    expect(classifyPersonal({ name: 'dob', type: 'DATE' }).reasons.join(' ')).toMatch(/"dob"/);
  });
});

describe('classifyPersonal with values', () => {
  it('finds email, card, SSN, IP and phone by value under an opaque name', () => {
    expect(cat('c1', { samples: ['a@x.com', 'b@y.org', 'c@z.net'] })).toBe('user.contact.email');
    expect(cat('f3', { samples: ['4111 1111 1111 1111', '5500 0000 0000 0004', '3400 0000 0000 009'] })).toBe('user.financial');
    expect(cat('f7', { samples: ['123-45-6789', '456-12-7890', '321-54-9876'] })).toBe('user.government_id.national_identification_number');
    expect(cat('src', { samples: ['10.0.0.1', '192.168.1.20', '203.0.113.7'] })).toBe('user.device.ip_address');
    expect(cat('f12', { samples: ['(555) 123-4567', '(555) 987-6543', '(555) 222-1818'] })).toBe('user.contact.phone_number');
  });
  it('rejects 16-digit numbers that fail the Luhn check', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(cat('f3', { samples: ['4111 1111 1111 1112', '5500 0000 0000 0005', '3400 0000 0000 000'] })).toBeNull();
  });
  it('tells precise coordinates from rounded ones by decimal places', () => {
    expect(cat('lat', { type: 'DOUBLE', samples: ['37.77493', '37.80441', '37.76812', '37.79001'] })).toBe('user.location.precise');
    expect(cat('lat', { type: 'DOUBLE', samples: ['37.8', '37.7', '37.6', '37.5'] })).toBe('user.location.imprecise');
  });
  it('a ZIP-shaped column with no ZIP name is only a guess', () => {
    const c = classifyPersonal({ name: 'code', samples: ['94110', '10001', '60614', '73301'] });
    expect(c.category).toBe('user.contact.address.postal_code');
    expect(needsConfirming(c)).toBe(true);
  });
  it('birth dates spread over decades look like birth dates', () => {
    expect(cat('d3', { samples: ['1984-03-12', '1972-11-30', '1995-07-04', '1960-01-19'] })).toBe('user.demographic.date_of_birth');
    expect(cat('d3', { samples: ['2024-03-12', '2024-11-30', '2025-07-04'] })).toBeNull();
  });
});

describe('parseDdl', () => {
  it('reads names and types, skipping constraints and comments', () => {
    const t = parseDdl(`
      -- people
      CREATE TABLE IF NOT EXISTS public."People" (
        id BIGINT PRIMARY KEY, /* the key */
        "Full Name" VARCHAR(80) NOT NULL,
        price DECIMAL(10,2) DEFAULT 0,
        PRIMARY KEY (id),
        CONSTRAINT fk FOREIGN KEY (id) REFERENCES other(id)
      );
      create table b (x int, y text);`);
    expect(t).toHaveLength(2);
    expect(t[0]).toEqual({ name: 'People', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'Full Name', type: 'VARCHAR(80)' }, { name: 'price', type: 'DECIMAL(10,2)' }] });
    expect(t[1].columns.map((c) => c.name)).toEqual(['x', 'y']);
  });
});
