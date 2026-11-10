import { joinParts, withCtes } from './joinsql';
import { planOf, type Mapping } from './mapping';
import { readerFor } from './load';
import { ident } from './sql/quote';

/** A runnable DuckDB SQL script: one statement per approved join, reading the original files. */
export function emitSqlScript(m: Mapping): string {
  const files = new Map(m.tables.map((t) => [t.name, t.read_from ?? t.file]));
  const enc = new Map(m.tables.map((t) => [t.name, t.encoding]));
  const source = (table: string) => `SELECT * FROM ${readerFor(files.get(table) ?? table, files.get(table) ?? table, enc.get(table)) ?? ident(table)}`;
  const out = [
    `-- Join Receipt ${m.version}: generated from mapping.yml. DuckDB SQL (run it next to the data files).`,
    `-- Keys are compared as text, after the listed transforms.`,
    ...m.tables.filter((t) => t.read_from).map((t) => `-- ${t.file} is read from ${t.read_from}, the CSV copy of sheet "${t.sheet?.name}" rows ${t.sheet?.header_row} to ${t.sheet?.last_row}. Download it next to this script.`),
  ];
  for (const j of m.joins.filter((x) => x.status === 'approved')) {
    const p = joinParts(planOf(j), [], source);
    out.push('', `-- ${j.id}: ${j.receipt.joined_rows} rows (${j.receipt.matched} left rows matched, ${j.receipt.unmatched_left} unmatched)`);
    out.push(withCtes(p.ctes, p.select.replace(/^SELECT .*$/m, 'SELECT *')) + ';');
  }
  return out.join('\n') + '\n';
}
