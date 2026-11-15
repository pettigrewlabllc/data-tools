import { stringify } from 'yaml';
import { sideRefs, type KeyRef } from './grammar';
import type { Mapping, MappingJoin } from './mapping';
import { TOOL, TOOL_VERSION, planOf } from './mapping';
import type { TableProfile } from './profile';
import type { Pattern } from './receipt';
import { compositeKeyExpr, crosswalkCtes, withClause } from './sql/emit';
import { ident } from './sql/quote';

/**
 * contract.yml: the approved joins as an Open Data Contract Standard (ODCS) 3.2.0 document, for tools that read data
 * contracts. Validated against the published JSON Schema in tests (src/odcs/, MIT, see NOTICE there).
 *
 * - Each file is a schema object; its columns are properties (when the profiles are known).
 * - Each approved join is a foreignKey relationship on its left file, from its key to the right file's key (arrays for
 *   composite keys). References use the fully qualified form (schema/<id>/properties/<id>), because the shorthand form
 *   can't hold column names with spaces, like "State FIPS Code".
 * - The match rate at approval is a quality check: type sql, unit percent, mustBeGreaterOrEqualTo, dimension
 *   consistency. The query is DuckDB SQL over the tables by name, with the same cleanup as the join.
 * - Cleanup steps and what the unmatched rows have in common go in customProperties, vendor "join-receipt".
 */
export const ODCS_VERSION = 'v3.2.0';

export interface ContractFindings { left: Pattern[]; right: Pattern[] }

/** A StableId: no whitespace and none of . # / \ @ ! % & ^. Made unique within its array. */
function stableIds(names: string[]): Map<string, string> {
  const out = new Map<string, string>(), used = new Set<string>();
  for (const n of names) {
    let base = n.replace(/[\s.#/\\@!%&^]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
    if (!/^[A-Za-z_]/.test(base)) base = `c_${base}`;
    let id = base, i = 2;
    while (used.has(id)) id = `${base}_${i++}`;
    used.add(id);
    out.set(n, id);
  }
  return out;
}

function logicalType(duck: string): string {
  if (/^(BIGINT|INTEGER|SMALLINT|TINYINT|HUGEINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT)$/.test(duck)) return 'integer';
  if (/^(DOUBLE|FLOAT|REAL|DECIMAL)/.test(duck)) return 'number';
  if (duck === 'BOOLEAN') return 'boolean';
  if (duck === 'DATE') return 'date';
  if (duck.startsWith('TIMESTAMP')) return 'timestamp';
  if (duck === 'TIME') return 'time';
  return 'string';
}

/** The share of left rows whose key finds a match on the right, as a percent, in DuckDB SQL. */
function matchRateSql(j: MappingJoin): string {
  const join = planOf(j).join;
  const lk = compositeKeyExpr(sideRefs(join, 'left'), 'l'), rk = compositeKeyExpr(sideRefs(join, 'right'), 'r');
  const ctes = crosswalkCtes([...sideRefs(join, 'left'), ...sideRefs(join, 'right')]);
  return `${withClause(ctes)}SELECT 100.0 * count(*) FILTER (WHERE ${lk} IN (SELECT ${rk} FROM ${ident(join.right.table)} AS r WHERE ${rk} IS NOT NULL)) / count(*) FROM ${ident(join.left.table)} AS l`;
}

export function buildContract(m: Mapping, profiles: TableProfile[] = [], findings: Record<string, ContractFindings> = {}): Record<string, unknown> {
  const tableIds = stableIds(m.tables.map((t) => t.name));
  const colIds = new Map<string, Map<string, string>>();
  const columnsOf = (table: string): string[] => {
    const p = profiles.find((x) => x.table === table);
    const keyCols = m.joins.flatMap((j) => [...sideRefs(planOf(j).join, 'left'), ...sideRefs(planOf(j).join, 'right')]).filter((k) => k.table === table).map((k) => k.column);
    return [...new Set([...(p?.columns.map((c) => c.name) ?? []), ...keyCols])];
  };
  for (const t of m.tables) colIds.set(t.name, stableIds(columnsOf(t.name)));
  const ref = (k: KeyRef) => `schema/${tableIds.get(k.table)}/properties/${colIds.get(k.table)!.get(k.column)}`;
  const refs = (ks: KeyRef[]) => (ks.length === 1 ? ref(ks[0]) : ks.map(ref));
  const approved = m.joins.filter((j) => j.status === 'approved');
  const joinIds = stableIds(approved.map((j) => j.id));

  const schema = m.tables.map((t) => {
    const p = profiles.find((x) => x.table === t.name);
    const mine = approved.filter((j) => j.left.table === t.name);
    const properties = columnsOf(t.name).map((name) => {
      const c = p?.columns.find((x) => x.name === name);
      return {
        id: colIds.get(t.name)!.get(name)!, name,
        ...(c ? { logicalType: logicalType(c.type), physicalType: c.type, required: c.nulls === 0, unique: c.unique } : {}),
      };
    });
    const relationships = mine.map((j) => {
      const join = planOf(j).join;
      const transforms = (side: 'left' | 'right') => sideRefs(join, side).filter((k) => k.transforms.length).map((k) => ({ column: k.column, steps: k.transforms }));
      const f = findings[j.id];
      const custom = [
        ...(transforms('left').length || transforms('right').length ? [{ property: 'keyCleanup', vendor: TOOL, value: { left: transforms('left'), right: transforms('right') }, description: 'Cleanup applied to each key before comparing, in order. Keys are compared as text.' }] : []),
        ...(f && (f.left.length || f.right.length) ? [{ property: 'unmatchedPatterns', vendor: TOOL, value: { left: f.left.map(pat), right: f.right.map(pat) }, description: 'Values over-represented among rows that found no match (lift = share among unmatched rows divided by share in the file).' }] : []),
        { property: 'joinType', vendor: TOOL, value: j.how },
      ];
      return { id: joinIds.get(j.id)!, type: 'foreignKey', from: refs(sideRefs(join, 'left')), to: refs(sideRefs(join, 'right')), customProperties: custom };
    });
    const quality = mine.map((j) => {
      const rows = j.receipt.matched + j.receipt.unmatched_left;
      const rate = rows ? Math.floor((1000 * j.receipt.matched) / rows) / 10 : 0;
      return {
        id: `${joinIds.get(j.id)}_match_rate`, name: `${j.left.table} rows that find a match in ${j.right.table}`,
        description: `At approval, ${j.receipt.matched} of ${rows} rows matched (${rate}%). Fail if it drops below that.`,
        type: 'sql', dimension: 'consistency', unit: 'percent', mustBeGreaterOrEqualTo: rate, query: matchRateSql(j),
      };
    });
    return {
      id: tableIds.get(t.name)!, name: t.name, physicalName: t.read_from ?? t.file, physicalType: 'file',
      ...(t.grain ? { dataGranularityDescription: `One row per ${t.grain.join(' × ')}` } : {}),
      properties,
      ...(relationships.length ? { relationships } : {}),
      ...(quality.length ? { quality } : {}),
    };
  });

  return {
    apiVersion: ODCS_VERSION, kind: 'DataContract',
    id: `join-receipt-${[...tableIds.values()].join('-')}`.slice(0, 120),
    name: `Joins between ${m.tables.map((t) => t.file).join(', ')}`,
    version: '1.0.0', status: 'draft',
    description: { purpose: 'The joins approved in Join Receipt: which keys connect these files, how they are cleaned, and the match rate each join had when it was approved.' },
    schema,
    customProperties: [{ property: 'generatedBy', vendor: TOOL, value: `${TOOL} ${TOOL_VERSION}` }],
  };
}

const pat = (p: Pattern) => ({ column: p.column, value: p.value, unmatchedRows: p.unmatchedCount, ofUnmatched: p.unmatchedTotal, lift: Math.round(p.lift * 100) / 100 });

export function contractYaml(m: Mapping, profiles: TableProfile[] = [], findings: Record<string, ContractFindings> = {}): string {
  return `# Open Data Contract Standard ${ODCS_VERSION}, written by Join Receipt. Same decisions as mapping.yml.\n` +
    stringify(buildContract(m, profiles, findings), { indent: 2, lineWidth: 0 });
}
