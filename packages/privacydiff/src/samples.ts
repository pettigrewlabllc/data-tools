/**
 * The sample: a made-up outdoors app, "Trailhead". The notice and the tables are synthetic, and each has a planted
 * mismatch: precise coordinates against "approximate location", date of birth and ZIP the notice never mentions, a
 * health column that only becomes a combination once it is linked to emails, and an under-13 field the notice says
 * it does not collect.
 */
export const SAMPLE_NOTICE = `Trailhead Privacy Notice

Information we collect

We collect your name and email address when you create an account.

We collect your approximate location to show you trails near you.

We collect your IP address and device identifiers to keep the service secure.

We do not knowingly collect personal information from children under 13.

How we use it

We use this information to provide the service, to understand how the app is used and to prevent fraud.`;

/** A small deterministic generator, so the sample is the same every time. */
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];

const FIRST = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kit', 'Lena', 'Max', 'Nia', 'Omar', 'Pia', 'Quinn', 'Rae', 'Sol', 'Tess'];
const LAST = ['Adler', 'Bose', 'Cruz', 'Dale', 'Egan', 'Fox', 'Gray', 'Hale', 'Iyer', 'Jain', 'Kane', 'Lund', 'Mora', 'Nash', 'Ono', 'Park'];
const ZIPS = ['94110', '94117', '10001', '60614', '73301', '98101', '02139', '80202'];
const DIAG = ['asthma', 'none', 'none', 'migraine', 'hypertension', 'none', 'diabetes', 'none'];

export function sampleFiles(): { name: string; bytes: Uint8Array }[] {
  const r = rng(7);
  const n = 60;
  const members: string[] = ['ref_code,email,full_name,dob,zip,gender,under_13,plan'];
  const logs: string[] = ['ref_code,lat,lon,ip_address,started_at,trail_name'];
  const wellness: string[] = ['ref_code,diagnosis,resting_heart_rate'];
  for (let i = 1; i <= n; i++) {
    const code = `M${String(i).padStart(4, '0')}`;
    const first = pick(r, FIRST), last = pick(r, LAST);
    const child = i % 15 === 0;
    const year = child ? 2014 + Math.floor(r() * 4) : 1950 + Math.floor(r() * 60);
    const dob = `${year}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
    members.push([code, `${first}.${last}${i}@example.com`.toLowerCase(), `${first} ${last}`, dob, pick(r, ZIPS), pick(r, ['F', 'M', 'X']), child ? 'true' : 'false', pick(r, ['free', 'pro'])].join(','));
    for (let k = 0; k < 2; k++) {
      logs.push([code, (37.7 + r() * 0.2).toFixed(5), (-122.5 + r() * 0.2).toFixed(5), `203.0.${Math.floor(r() * 250)}.${1 + Math.floor(r() * 250)}`, `2026-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}T08:30:00`, pick(r, ['Ridge Loop', 'Creek Trail', 'Summit Path'])].join(','));
    }
    if (i % 3 === 0) wellness.push([code, pick(r, DIAG), 55 + Math.floor(r() * 30)].join(','));
  }
  const enc = (s: string) => new TextEncoder().encode(s + '\n');
  return [
    { name: 'members.csv', bytes: enc(members.join('\n')) },
    { name: 'trail_logs.csv', bytes: enc(logs.join('\n')) },
    { name: 'wellness.csv', bytes: enc(wellness.join('\n')) },
  ];
}

export const SAMPLE_DDL_HINT = `CREATE TABLE events (
  user_id BIGINT,
  lat DOUBLE,
  lon DOUBLE,
  email VARCHAR
);`;
