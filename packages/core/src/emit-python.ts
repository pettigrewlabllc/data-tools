import type { Aggregate, KeyRef, Transform } from './grammar';
import { CROSSWALKS } from './sql/crosswalks';
import { planOf, type Mapping, type MappingJoin } from './mapping';

const py = (s: string) => JSON.stringify(s); // JSON strings are valid Python string literals for our inputs
const pyVar = (s: string) => {
  const v = s.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(v) ? `t_${v}` : v;
};

function reader(file: string, keyCols: string[]): string {
  const ext = file.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  const dtype = `dtype={${keyCols.map((c) => `${py(c)}: str`).join(', ')}}`;
  if (ext === '.parquet') return `pd.read_parquet(${py(file)}).astype({${keyCols.map((c) => `${py(c)}: "string"`).join(', ')}})`;
  if (ext === '.json' || ext === '.ndjson' || ext === '.jsonl') return `pd.read_json(${py(file)}, lines=${ext !== '.json' ? 'True' : 'False'}, ${dtype})`;
  if (ext === '.tsv') return `pd.read_csv(${py(file)}, sep="\\t", ${dtype}, keep_default_na=False, na_values=[""])`;
  return `pd.read_csv(${py(file)}, ${dtype}, keep_default_na=False, na_values=[""])`;
}

/** Python mirroring sql/emit.ts transformSql exactly (DuckDB lpad truncates, so we slice too). */
function transformPy(x: string, t: Transform, crosswalkVar: (t: Extract<Transform, { op: 'crosswalk' }>) => string): string {
  switch (t.op) {
    case 'trim': return `${x}.str.strip()`;
    case 'lower': return `${x}.str.lower()`;
    case 'upper': return `${x}.str.upper()`;
    case 'lpad': return `${x}.str.rjust(${t.width}, ${py(t.fill)}).str[:${t.width}]`;
    case 'cast':
      if (t.to === 'varchar') return x;
      if (t.to === 'integer') return `pd.to_numeric(${x}, errors="coerce").astype("Int64").astype("string")`;
      return `pd.to_datetime(${x}, errors="coerce").dt.strftime("%Y-%m-%d")`;
    case 'date_trunc': {
      const p = t.unit === 'day' ? 'D' : t.unit === 'month' ? 'M' : 'Y';
      return `pd.to_datetime(${x}, errors="coerce").dt.to_period("${p}").dt.start_time.dt.strftime("%Y-%m-%d")`;
    }
    case 'crosswalk': {
      const look = t.from === 'fips' ? `${x}.str.strip().str.rjust(2, "0").str[:2]` : `${x}.str.strip().str.upper()`;
      return `${look}.map(${crosswalkVar(t)})`;
    }
  }
}

function aggPy(df: string, a: Aggregate): string {
  const spec = a.measures.map((m) => `${py(m.column)}: (${py(m.column)}, ${py(m.fn === 'first' ? 'min' : m.fn)})`).join(', ');
  return `${df} = ${df}.groupby(${JSON.stringify(a.by)}, as_index=False, dropna=False).agg(**{${spec}})`;
}

/** A pandas snippet that reproduces each approved join and asserts the receipt's row count. */
export function emitPython(m: Mapping): string {
  const approved = m.joins.filter((j) => j.status === 'approved');
  const files = new Map(m.tables.map((t) => [t.name, t.file]));
  const lines = [`# Join Receipt ${m.version}: generated from mapping.yml.`, `# Keys are compared as text, after the listed transforms; rows with no key never match.`, 'import pandas as pd', ''];
  const crosswalks = new Map<string, string>();
  const cwVar = (t: Extract<Transform, { op: 'crosswalk' }>) => {
    const name = `${t.table.toUpperCase()}_${t.from.toUpperCase()}_TO_${t.to.toUpperCase()}`;
    if (!crosswalks.has(name)) {
      const pairs = CROSSWALKS[t.table].rows
        .filter((r) => r[t.from] && r[t.to])
        .map((r) => `${py(t.from === 'fips' ? r[t.from]! : r[t.from]!.toUpperCase())}: ${py(r[t.to]!)}`);
      crosswalks.set(name, `${name} = {${pairs.join(', ')}}  # ${CROSSWALKS[t.table].source}`);
    }
    return name;
  };
  const body: string[] = [];
  for (const j of approved) body.push(...joinPy(j, files, cwVar));
  return [...lines, ...crosswalks.values(), ...(crosswalks.size ? [''] : []), ...body].join('\n') + '\n';
}

function keyPy(df: string, k: KeyRef, cw: (t: Extract<Transform, { op: 'crosswalk' }>) => string): string {
  let x = `${df}[${py(k.column)}].astype("string")`;
  for (const t of k.transforms) x = transformPy(x, t, cw);
  return x;
}

function joinPy(j: MappingJoin, files: Map<string, string>, cw: (t: Extract<Transform, { op: 'crosswalk' }>) => string): string[] {
  const plan = planOf(j);
  const L = `${pyVar(j.left.table)}_df`, R = `${pyVar(j.right.table)}_df`;
  const out = [
    `# ${j.id}`,
    `${L} = ${reader(files.get(j.left.table) ?? j.left.table, [j.left.column])}`,
    `${R} = ${reader(files.get(j.right.table) ?? j.right.table, [j.right.column])}`,
  ];
  if (plan.aggregateLeft) out.push(aggPy(L, plan.aggregateLeft));
  if (plan.aggregateRight) out.push(aggPy(R, plan.aggregateRight));
  out.push(`${L}["_jr_key"] = ${keyPy(L, j.left, cw)}`);
  out.push(`${R}["_jr_key"] = ${keyPy(R, j.right, cw)}`);
  out.push(`${R} = ${R}[${R}["_jr_key"].notna()]`);
  if (j.how === 'inner') out.push(`${L} = ${L}[${L}["_jr_key"].notna()]`);
  const rightUnique = j.receipt.max_per_key_right <= 1 || !!plan.aggregateRight;
  const validate = rightUnique ? `, validate="m:1"` : '';
  const df = `${pyVar(j.id)}`;
  out.push(`${df} = ${L}.merge(${R}, on="_jr_key", how=${py(j.how)}, suffixes=("", "_${pyVar(j.right.table)}")${validate}).drop(columns="_jr_key")`);
  out.push(`assert len(${df}) == ${j.receipt.joined_rows}, f"expected ${j.receipt.joined_rows} rows, got {len(${df})}"`, '');
  return out;
}
