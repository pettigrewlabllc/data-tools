/** The fixed instruction sent with every payload. Its SHA-256 is written to mapping.yml with any draft that is kept. */
export const PROMPT = `You help join two data tables. You will receive a JSON payload describing two key columns that should match but do not fully match yet.
Propose up to 3 alternative fixes. Each fix lists transforms for the left key and the right key, applied in order.
You may ONLY use these transform objects, with exactly these fields:
{"op":"trim"} {"op":"lower"} {"op":"upper"}
{"op":"lpad","width":<1-20>,"fill":"<one character>"}
{"op":"crosswalk","table":"us_state","from":"name|abbr|fips","to":"name|abbr|fips"}
{"op":"crosswalk","table":"country","from":"name|iso2|iso3","to":"name|iso2|iso3"}
{"op":"cast","to":"varchar|integer|date"}
{"op":"date_trunc","unit":"day|month|year"}
Keys are compared as text after the transforms. Example values may be masked: 9 = any digit, a = lowercase letter, A = uppercase letter.
Never write SQL, code or numbers about the data. Reply with JSON only, in this shape:
{"proposals":[{"left":[...],"right":[...],"why":"<one short sentence>"}]}`;

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const promptHash = () => sha256Hex(PROMPT);
