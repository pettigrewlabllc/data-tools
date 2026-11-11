import { createHash } from 'node:crypto';

/**
 * A fingerprint of one output. Holds digests and a row count, never values (ADR 0005).
 * `ordered` changes when rows move; `unordered` only when the multiset of rows changes;
 * `rounded` is `unordered` with non-integer numbers cut to 10 significant digits, so
 * float-summation noise can be told apart from real value changes.
 */
export interface Fingerprint {
  rows: number;
  ordered: string;
  unordered: string;
  rounded: string;
  columns: Record<string, string>;
  order_matters: boolean;
  /** Set when there was nothing hashable (an image, a widget). */
  skipped?: string;
}

const MOD128 = (1n << 128n) - 1n;
const MOD64 = (1n << 64n) - 1n;

function sha(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}
function big(buf: Buffer, bytes: number): bigint {
  return BigInt('0x' + buf.subarray(0, bytes).toString('hex'));
}
const hex = (n: bigint, bytes: number) => n.toString(16).padStart(bytes * 2, '0');

/** Canonical, type-tagged encoding of one value. Same value → same string, across runs. */
export function encodeValue(v: unknown, round = false): string {
  if (v === null || v === undefined) return 'N';
  switch (typeof v) {
    case 'number':
      if (Number.isNaN(v)) return 'd:NaN';
      if (round && !Number.isInteger(v)) return 'd:' + Number(v.toPrecision(10)).toString();
      return 'd:' + v.toString();
    case 'bigint':
      return 'd:' + v.toString();
    case 'boolean':
      return v ? 'b:1' : 'b:0';
    case 'string': {
      if (round && /^-?\d+\.\d+(e[-+]?\d+)?$/i.test(v)) return 'd:' + Number(Number(v).toPrecision(10)).toString();
      return 's:' + JSON.stringify(v);
    }
    default:
      if (v instanceof Date) return 't:' + v.toISOString();
      if (Array.isArray(v)) return '[' + v.map((x) => encodeValue(x, round)).join(',') + ']';
      if (v instanceof Uint8Array) return 'x:' + Buffer.from(v).toString('hex');
      if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + encodeValue(o[k], round)).join(',') + '}';
      }
      return 'o:' + String(v);
  }
}

/** Streams rows in and produces a Fingerprint. Keeps only digests in memory. */
export class Fingerprinter {
  private rows = 0;
  private ordered = createHash('sha256');
  private unordered = 0n;
  private rounded = 0n;
  private cols: bigint[];
  constructor(private columnNames: string[], private orderMatters: boolean) {
    this.cols = columnNames.map(() => 0n);
    this.ordered.update('cols:' + JSON.stringify(columnNames) + '\n');
  }
  addRow(values: readonly unknown[]): void {
    const enc = values.map((v) => encodeValue(v));
    const line = enc.join('\u001f');
    const d = sha(line);
    this.ordered.update(d);
    this.unordered = (this.unordered + big(d, 16)) & MOD128;
    const r = values.map((v) => encodeValue(v, true)).join('\u001f');
    this.rounded = (this.rounded + big(sha(r), 16)) & MOD128;
    for (let i = 0; i < enc.length; i++) this.cols[i] = (this.cols[i] + big(sha(enc[i]), 8)) & MOD64;
    this.rows++;
  }
  finish(): Fingerprint {
    const schema = 'cols:' + JSON.stringify(this.columnNames);
    const tag = (n: bigint, bytes: number) => hex(big(sha(schema + ':' + this.rows + ':' + hex(n, bytes)), 16), 16);
    const columns: Record<string, string> = {};
    this.columnNames.forEach((c, i) => (columns[c] = tag(this.cols[i], 8)));
    return {
      rows: this.rows,
      ordered: this.ordered.digest('hex').slice(0, 32),
      unordered: tag(this.unordered, 16),
      rounded: tag(this.rounded, 16),
      columns,
      order_matters: this.orderMatters,
    };
  }
}

/** Fingerprint of raw bytes (a source file, a COPY TO output). */
export function bytesFingerprint(bytes: Uint8Array): Fingerprint {
  const h = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return { rows: 1, ordered: h, unordered: h, rounded: h, columns: {}, order_matters: false };
}

/** The digest used as a step input: honours order only where order is defined. */
export function identity(fp: Fingerprint): string {
  if (fp.skipped) return 'skipped';
  return fp.order_matters ? fp.ordered : fp.unordered;
}

export function sourceHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
