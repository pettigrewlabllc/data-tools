/**
 * Grammar → JSONata. The emitted text is the transform the user takes home, and the same text runs the
 * mapping on screen and in validation. Each op's semantics are in the PRD's grammar table and ADR 0005; the
 * helpers below exist because JSONata's defaults differ from them (null is a value, `$trim` collapses inner
 * whitespace, `$number("abc")` throws, `$toMillis` reads a timestamp without an offset as local time).
 */
import type { FieldMapping, Path, Scalar, Source, Transform } from './grammar';

const q = (k: string) => '`' + k.replace(/`/g, '``') + '`';
const lit = (v: Scalar) => JSON.stringify(v);
const nav = (ctx: string, p: Path) => (p.length ? `${ctx}.${p.map(q).join('.')}` : ctx);

export const JSONATA_HELPERS = String.raw`$fm_u := $fm_missing;
  $fm_nn := function($v){ $v = null ? $fm_u : $v };
  $fm_has := function($s){ $exists($s) and $s != "" };
  $fm_list := function($v){ $type($v) = "array" ? $v : ($exists($v) and $v != null) ? [$v] : [] };
  $fm_obj := function($o){ $count($keys($o)) = 0 ? $fm_u : $o };
  $fm_trim := function($v){ $type($v) = "string" ? $replace($v, /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/, "") : $v };
  $fm_lower := function($v){ $type($v) = "string" ? $lowercase($v) : $v };
  $fm_upper := function($v){ $type($v) = "string" ? $uppercase($v) : $v };
  $fm_num := function($v){ $type($v) = "number" ? $v : ($type($v) = "string" and $contains($v, /^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/) and $length($replace($fm_trim($v), /^-/, "")) <= 15) ? $number($fm_trim($v)) : $fm_u };
  $fm_int := function($v){ ($n := $fm_num($v); ($exists($n) and $floor($n) = $n) ? $n : $fm_u) };
  $fm_str := function($v){ $type($v) = "string" ? $v : $type($v) = "number" ? $string($v) : $type($v) = "boolean" ? ($v ? "true" : "false") : $fm_u };
  $fm_bool := function($v){ $type($v) = "boolean" ? $v : $v = 1 ? true : $v = 0 ? false : $type($v) = "string" ? ($s := $lowercase($fm_trim($v)); $s in ["true", "yes", "y", "1"] ? true : $s in ["false", "no", "n", "0"] ? false : $fm_u) : $fm_u };
  $fm_ms := function($ms){ ($exists($ms) and $ms >= -62135596800000 and $ms <= 253402300799999) ? $fromMillis($floor($ms)) : $fm_u };
  $fm_digits := function($v, $drop){ ($s := $type($v) = "number" ? ($floor($v) = $v ? $string($v) : "") : $type($v) = "string" ? $v : ""; ($contains($s, /^-?\d+$/) and $length($s) > $drop and $length($s) - $drop <= 15) ? $number($substring($s, 0, $length($s) - $drop)) : $fm_u) };
  $fm_iso := function($v){ $type($v) = "string" ? ($m := $match($v, /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/)[0]; $exists($m) ? ($g := $m.groups; $y := $number($g[0]); $mo := $number($g[1]); $d := $number($g[2]); $day := $fm_ms($toMillis($g[0] & "-" & $g[1] & "-" & $g[2] & "T00:00:00Z")); ($exists($day) and $substring($day, 0, 10) = ($g[0] & "-" & $g[1] & "-" & $g[2]) and (($fm_has($g[3]) = false) or ($number($g[3]) <= 23 and $number($g[4]) <= 59 and $number($g[5]) <= 59))) ? $fm_ms($toMillis($g[0] & "-" & $g[1] & "-" & $g[2] & "T" & ($fm_has($g[3]) = false ? "00:00:00" : $g[3] & ":" & $g[4] & ":" & $g[5]) & ($fm_has($g[6]) = false ? "" : $substring($g[6] & "000", 0, 4)) & ($fm_has($g[7]) = false ? "Z" : $g[7]))) : $fm_u) : $fm_u) : $fm_u };
  $fm_usdate := function($v){ $type($v) = "string" ? ($m := $match($v, /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)[0]; $exists($m) ? ($p := function($n){ $length($n) = 1 ? "0" & $n : $n }; $fm_iso($m.groups[2] & "-" & $p($m.groups[0]) & "-" & $p($m.groups[1]))) : $fm_u) : $fm_u };
  $fm_date := function($v, $from, $out){ ($r := $from = "iso" ? $fm_iso($v) : $from = "us_date" ? $fm_usdate($v) : $from = "epoch_s" ? ($n := $fm_num($v); $exists($n) ? $fm_ms($n * 1000) : $fm_u) : $from = "epoch_ms" ? $fm_ms($fm_num($v)) : $from = "epoch_us" ? $fm_ms($fm_digits($v, 3)) : $fm_ms($fm_digits($v, 6)); ($exists($r) and $out = "date") ? $substring($r, 0, 10) : $r) };
  $fm_scale := function($v, $mul, $div){ $type($v) = "number" ? ($div > 1 ? $v / $div : $v * $mul) : $fm_u };
  $fm_join := function($parts, $sep){ $count($parts) = 0 ? $fm_u : $join($parts, $sep) };`;

function transform(expr: string, t: Transform): string {
  switch (t.op) {
    case 'trim': return `$fm_trim(${expr})`;
    case 'lower': return `$fm_lower(${expr})`;
    case 'upper': return `$fm_upper(${expr})`;
    case 'cast': return `$fm_${t.to === 'string' ? 'str' : t.to === 'integer' ? 'int' : t.to === 'number' ? 'num' : 'bool'}(${expr})`;
    case 'parse_date': return `$fm_date(${expr}, ${lit(t.from)}, ${lit(t.out)})`;
    case 'scale': return t.power > 0 ? `$fm_scale(${expr}, ${10 ** t.power}, 1)` : `$fm_scale(${expr}, 1, ${10 ** -t.power})`;
    case 'value_map': {
      const keys = Object.keys(t.map).sort();
      const obj = `{${keys.map((k) => `${JSON.stringify(k)}: ${lit(t.map[k])}`).join(', ')}}`;
      return `$lookup(${obj}, $fm_str(${expr}))`;
    }
  }
}

const chain = (expr: string, ts: Transform[]) => ts.reduce(transform, expr);

function source(s: Source, ctx: string, ts: Transform[], indent: string): string {
  switch (s.op) {
    case 'path': return `$fm_nn(${chain(`$fm_nn(${nav(ctx, s.path)})`, ts)})`;
    case 'coalesce': {
      const ps = s.paths.map((p) => `$fm_nn(${nav(ctx, p)})`);
      const pick = ps.slice(0, -1).reduceRight((acc, p) => `$exists(${p}) ? ${p} : ${acc}`, ps[ps.length - 1]);
      return `$fm_nn(${chain(`(${pick})`, ts)})`;
    }
    case 'concat': return `$fm_nn(${chain(`$fm_join([${s.paths.map((p) => `$fm_str($fm_nn(${nav(ctx, p)}))`).join(', ')}], ${lit(s.sep)})`, ts)})`;
    case 'pick': {
      const list = `$fm_list(${nav(ctx, s.array)})`;
      const pred = s.which === 'first' ? '[0]' : s.which === 'last' ? '[-1]' : `[${s.which.key.map(q).join('.')} = ${lit(s.which.equals)}][0]`;
      const item = `(${list}${pred})`;
      return `$fm_nn(${chain(`$fm_nn(${s.field.length ? nav(item, s.field) : item})`, ts)})`;
    }
    case 'values': {
      const list = `$fm_list(${nav(ctx, s.array)})`;
      const vals = s.field.length ? `$map(${list}, function($fm_it){ $fm_nn(${nav('$fm_it', s.field)}) })` : `$map(${list}, function($fm_it){ $fm_nn($fm_it) })`;
      return ts.length ? `$append([], $map(${vals}, function($fm_v){ $fm_nn(${chain('$fm_v', ts)}) }))` : `$append([], ${vals})`;
    }
    case 'count': return chain(`$count($fm_list(${nav(ctx, s.array)}))`, ts);
    case 'constant': return `$fm_nn(${chain(lit(s.value), ts)})`;
    case 'nested': {
      const inner = objectExpr(s.fields, '$fm_item', indent + '  ');
      return `$append([], $map($fm_list(${nav(ctx, s.array)}), function($fm_item){ ${inner} }))`;
    }
  }
}

interface Node { expr?: string; children: Map<string, Node> }

function objectExpr(fields: FieldMapping[], ctx: string, indent: string): string {
  const root: Node = { children: new Map() };
  for (const f of fields) {
    let n = root;
    for (const k of f.target.slice(0, -1)) { if (!n.children.has(k)) n.children.set(k, { children: new Map() }); n = n.children.get(k)!; }
    const leaf = f.target[f.target.length - 1];
    n.children.set(leaf, { expr: source(f.source, ctx, f.transforms, indent), children: n.children.get(leaf)?.children ?? new Map() });
  }
  const render = (n: Node, ind: string): string => {
    const parts = [...n.children.entries()].map(([k, c]) => `${ind}  ${JSON.stringify(k)}: ${c.expr ?? render(c, ind + '  ')}`);
    return `$fm_obj({\n${parts.join(',\n')}\n${ind}})`;
  };
  return render(root, indent);
}

/** One expression that maps one record. Apply it to each record (`$map(records, ...)` or per record). */
export function compileJsonata(fields: FieldMapping[]): string {
  return `(\n  ${JSONATA_HELPERS}\n  ${objectExpr(fields, '$$', '  ')}\n)\n`;
}

/** The expression for one field alone, wrapped the same way, for per-field validation. */
export function compileField(field: FieldMapping): string {
  return compileJsonata([field]);
}
