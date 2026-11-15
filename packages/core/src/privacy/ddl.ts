export interface DdlTable { name: string; columns: { name: string; type: string }[] }

const CONSTRAINT = /^(primary|foreign|unique|constraint|check|key|index|fulltext|exclude|like|partition)\b/i;

/** Remove -- and C-style comments, leaving string literals alone. */
function stripComments(sql: string): string {
  let out = '', i = 0;
  while (i < sql.length) {
    const ch = sql[i], nx = sql[i + 1];
    if (ch === "'" ) { const j = sql.indexOf("'", i + 1); const end = j < 0 ? sql.length : j + 1; out += sql.slice(i, end); i = end; continue; }
    if (ch === '-' && nx === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (ch === '/' && nx === '*') { const j = sql.indexOf('*/', i + 2); i = j < 0 ? sql.length : j + 2; out += ' '; continue; }
    out += ch; i++;
  }
  return out;
}

function splitTop(body: string): string[] {
  const parts: string[] = []; let depth = 0, cur = '', q: string | null = null;
  for (const ch of body) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const unquote = (s: string) => s.replace(/^["`\[]|["`\]]$/g, '');

/** Read CREATE TABLE statements: names and types only. Handles IF NOT EXISTS, schema prefixes, quoted names, constraints. */
export function parseDdl(text: string): DdlTable[] {
  const sql = stripComments(text);
  const tables: DdlTable[] = [];
  const re = /create\s+(?:or\s+replace\s+)?(?:(?:temp|temporary|external|unlogged|global|local)\s+)*table\s+(?:if\s+not\s+exists\s+)?((?:[`"\[]?[\w$ -]+[`"\]]?\s*\.\s*)*[`"\[]?[\w$-]+[`"\]]?)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    let depth = 1, i = re.lastIndex, q: string | null = null;
    const start = i;
    for (; i < sql.length && depth > 0; i++) {
      const ch = sql[i];
      if (q) { if (ch === q) q = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    const body = sql.slice(start, i - 1);
    const name = unquote(m[1].split('.').pop()!.trim());
    const columns: DdlTable['columns'] = [];
    for (const part of splitTop(body)) {
      if (CONSTRAINT.test(part)) continue;
      const cm = /^("[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+)\s*(.*)$/s.exec(part);
      if (!cm) continue;
      const rest = cm[2];
      // The type runs up to the first constraint keyword.
      const tm = /^(.*?)(?:\s+(?:not\s+null|null|default|primary|unique|references|check|constraint|generated|collate|comment|auto_?increment|identity)\b.*)?$/is.exec(rest);
      const type = (tm?.[1] ?? rest).trim().replace(/\s+/g, ' ');
      columns.push({ name: unquote(cm[1]), type: type.toUpperCase() });
    }
    tables.push({ name, columns });
    re.lastIndex = i;
  }
  return tables;
}
