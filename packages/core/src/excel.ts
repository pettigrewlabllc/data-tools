import readXlsxFile from 'read-excel-file/universal';

/** Where the table sits in a workbook, so exported SQL and pandas can read the same cells. */
export interface SheetRange { sheet: string; sheetCount: number; headerRow: number; lastRow: number; width: number }
export interface ExcelTable { csv: string; range: SheetRange }

type Cell = string | number | boolean | Date | null;

const filled = (row: Cell[]) => row.filter((c) => c !== null && String(c).trim() !== '').length;

function text(c: Cell): string {
  if (c === null) return '';
  if (c instanceof Date) {
    const iso = c.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('T', ' ').replace(/\.000Z$/, '');
  }
  return String(c);
}

function csvField(s: string): string {
  return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Find the table in a sheet. Government workbooks put title rows above the header and footnotes below
 * the data, so the header is the first row that fills most of the sheet's width, and short rows at the
 * bottom are dropped. Rows are 1-based, as in Excel.
 */
export function findTable(rows: Cell[][]): { header: number; last: number; width: number } | null {
  const probe = rows.slice(0, 50);
  const width = Math.max(0, ...probe.map(filled));
  if (width < 2) return null;
  const header = probe.findIndex((r) => filled(r) >= Math.max(2, Math.ceil(width * 0.8)));
  if (header < 0) return null;
  let last = rows.length - 1;
  while (last > header && filled(rows[last]) < Math.max(2, Math.ceil(width * 0.5))) last--;
  if (last === header) return null;
  return { header: header + 1, last: last + 1, width };
}

/** The first sheet with a table in it, as CSV text, plus where it was found. */
export async function excelToCsv(bytes: Uint8Array): Promise<ExcelTable> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const sheets = await readXlsxFile(buf);
  for (const s of sheets) {
    const rows = s.data as unknown as Cell[][];
    const t = findTable(rows);
    if (!t) continue;
    // Columns past the header's last filled cell are notes, not data.
    const head = rows[t.header - 1];
    let w = head.length;
    while (w > 0 && (head[w - 1] === null || String(head[w - 1]).trim() === '')) w--;
    const lines: string[] = [];
    const seen = new Map<string, number>();
    lines.push(head.slice(0, w).map((c, i) => {
      let name = text(c).replace(/\s+/g, ' ').trim() || `column_${i + 1}`;
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      if (n > 1) name = `${name}_${n}`;
      return csvField(name);
    }).join(','));
    for (let r = t.header; r < t.last; r++) {
      const row = rows[r] ?? [];
      if (filled(row) === 0) continue;
      lines.push(Array.from({ length: w }, (_, i) => csvField(text(row[i] ?? null))).join(','));
    }
    return { csv: lines.join('\n') + '\n', range: { sheet: s.sheet, sheetCount: sheets.length, headerRow: t.header, lastRow: t.last, width: w } };
  }
  throw new Error('no sheet in this workbook has a table with a header row');
}

/** Excel column letters for a 1-based column number (1 → A, 27 → AA). */
export function columnLetters(n: number): string {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
