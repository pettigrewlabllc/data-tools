/** Quote an identifier: always double quotes, inner quotes doubled. */
export function ident(s: string): string {
  return '"' + s.replace(/"/g, '""') + '"';
}

/** Quote a literal: strings single-quoted with inner quotes doubled; finite numbers as-is. */
export function lit(v: string | number): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('non-finite number in SQL literal');
    return String(v);
  }
  return "'" + v.replace(/'/g, "''") + "'";
}
