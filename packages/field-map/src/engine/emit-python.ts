/**
 * Grammar → Python (with a pandas wrapper). Generated as text from the same grammar as the JSONata transform,
 * and held to the same output in canonical form by the equivalence test on every fixture. The helpers mirror
 * the JSONata ones line for line; where Python's defaults differ from JavaScript's (number printing, 1 == True,
 * path navigation over arrays) the helper says so.
 */
import type { FieldMapping, Path, Scalar, Source, Transform } from './grammar';

const py = (v: Scalar): string => (v === null ? 'None' : typeof v === 'boolean' ? (v ? 'True' : 'False') : JSON.stringify(v));
const pyPath = (p: Path) => `[${p.map((k) => JSON.stringify(k)).join(', ')}]`;

export const PYTHON_HELPERS = String.raw`import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

# None means "missing" throughout: the mapping treats a missing field and a null the same way.

def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)

def _get(v, path):
    # JSONata path semantics: stepping through an array maps over its items and flattens the results.
    vals, mapped = [v], False
    for k in path:
        nxt = []
        for c in vals:
            if isinstance(c, list):
                mapped = True
            for it in (c if isinstance(c, list) else [c]):
                if isinstance(it, dict) and k in it:
                    nxt.append(it[k])
        vals = nxt
    if not vals:
        return None
    if not mapped:
        return vals[0]
    flat = []
    for x in vals:
        flat.extend(x if isinstance(x, list) else [x])
    return flat[0] if len(flat) == 1 else (flat or None)

def _list(v):
    return v if isinstance(v, list) else ([] if v is None else [v])

def _obj(o):
    o = {k: x for k, x in o.items() if x is not None}
    return o or None

def _eq(a, b):
    # JSONata equality: true != 1 and "1" != 1.
    if isinstance(a, (bool, str)) or isinstance(b, (bool, str)):
        return type(a) is type(b) and a == b
    return _is_num(a) and _is_num(b) and a == b

_WS = re.compile(r"^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$")
_NUM = re.compile(r"^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$")

def _trim(v):
    return _WS.sub("", v) if isinstance(v, str) else v

def _lower(v):
    return v.lower() if isinstance(v, str) else v

def _upper(v):
    return v.upper() if isinstance(v, str) else v

def _tidy(n):
    return int(n) if isinstance(n, float) and n.is_integer() and abs(n) < 1e21 else n

def _num(v):
    if _is_num(v):
        return v
    if isinstance(v, str) and _NUM.match(v):
        t = _trim(v)
        if len(t[1:] if t.startswith("-") else t) <= 15:
            return _tidy(float(t))
    return None

def _int(v):
    n = _num(v)
    return n if n is not None and math.floor(n) == n else None

def _js_num_str(n):
    # JavaScript's String(n) after JSONata's 15-significant-digit rounding.
    if isinstance(n, int):
        return str(n)
    if n.is_integer() and abs(n) < 1e21:
        return str(int(n))
    s = repr(float("%.15g" % n))
    if "e" in s:
        m, e = s.split("e")
        e = int(e)
        s = format(Decimal(s), "f") if -7 < e < 21 else m + "e" + ("+" if e > 0 else "-") + str(abs(e))
    return s

def _str(v):
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "true" if v else "false"
    if _is_num(v):
        return _js_num_str(v)
    return None

def _bool(v):
    if isinstance(v, bool):
        return v
    if _is_num(v):
        return True if v == 1 else False if v == 0 else None
    if isinstance(v, str):
        s = _trim(v).lower()
        return True if s in ("true", "yes", "y", "1") else False if s in ("false", "no", "n", "0") else None
    return None

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

def _ms(ms):
    if ms is None or not (-62135596800000 <= ms <= 253402300799999):
        return None
    ms = math.floor(ms)
    d = _EPOCH + timedelta(milliseconds=ms)
    return "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ" % (d.year, d.month, d.day, d.hour, d.minute, d.second, ms % 1000)

def _digits(v, drop):
    s = (str(int(v)) if math.floor(v) == v else "") if _is_num(v) else v if isinstance(v, str) else ""
    if re.match(r"^-?\d+$", s) and len(s) > drop and len(s) - drop <= 15:
        return int(s[: len(s) - drop])
    return None

_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$")

def _iso(v):
    if not isinstance(v, str):
        return None
    m = _ISO.match(v)
    if not m:
        return None
    y, mo, d, h, mi, s, frac, off = m.groups()
    try:
        day = date(int(y), int(mo), int(d))
    except ValueError:
        return None
    if h is not None and (int(h) > 23 or int(mi) > 59 or int(s) > 59):
        return None
    secs = (day - date(1970, 1, 1)).days * 86400 + (int(h) * 3600 + int(mi) * 60 + int(s) if h is not None else 0)
    ms = secs * 1000 + (int((frac + "000")[1:4]) if frac else 0)
    if off and off != "Z":
        sign = 1 if off[0] == "+" else -1
        ms -= sign * (int(off[1:3]) * 60 + int(off[4:6])) * 60000
    return _ms(ms)

def _usdate(v):
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", v) if isinstance(v, str) else None
    return _iso("%s-%02d-%02d" % (m.group(3), int(m.group(1)), int(m.group(2)))) if m and len(m.group(1)) <= 2 else None

def _date(v, frm, out):
    if frm == "iso":
        r = _iso(v)
    elif frm == "us_date":
        r = _usdate(v)
    elif frm == "epoch_s":
        n = _num(v)
        r = _ms(n * 1000) if n is not None else None
    elif frm == "epoch_ms":
        r = _ms(_num(v))
    else:
        r = _ms(_digits(v, 3 if frm == "epoch_us" else 6))
    return r[:10] if r is not None and out == "date" else r

def _scale(v, mul, div):
    if not _is_num(v):
        return None
    return v / div if div > 1 else v * mul

def _join(parts, sep):
    parts = [p for p in parts if p is not None]
    return sep.join(parts) if parts else None

def _first(items):
    return items[0] if items else None

def _where(items, key, value):
    return [it for it in items if _eq(_get(it, key), value)]
`;

function transform(expr: string, t: Transform): string {
  switch (t.op) {
    case 'trim': return `_trim(${expr})`;
    case 'lower': return `_lower(${expr})`;
    case 'upper': return `_upper(${expr})`;
    case 'cast': return `_${t.to === 'string' ? 'str' : t.to === 'integer' ? 'int' : t.to === 'number' ? 'num' : 'bool'}(${expr})`;
    case 'parse_date': return `_date(${expr}, ${JSON.stringify(t.from)}, ${JSON.stringify(t.out)})`;
    case 'scale': return t.power > 0 ? `_scale(${expr}, ${10 ** t.power}, 1)` : `_scale(${expr}, 1, ${10 ** -t.power})`;
    case 'value_map': {
      const keys = Object.keys(t.map).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}: ${py(t.map[k])}`).join(', ')}}.get(_str(${expr}))`;
    }
  }
}

const chain = (expr: string, ts: Transform[]) => ts.reduce(transform, expr);

function source(s: Source, ctx: string, ts: Transform[], indent: string): string {
  switch (s.op) {
    case 'path': return chain(`_get(${ctx}, ${pyPath(s.path)})`, ts);
    case 'coalesce': return chain(`next((x for x in (${s.paths.map((p) => `_get(${ctx}, ${pyPath(p)})`).join(', ')}) if x is not None), None)`, ts);
    case 'concat': return chain(`_join([${s.paths.map((p) => `_str(_get(${ctx}, ${pyPath(p)}))`).join(', ')}], ${JSON.stringify(s.sep)})`, ts);
    case 'pick': {
      const list = `_list(_get(${ctx}, ${pyPath(s.array)}))`;
      const item = s.which === 'first' ? `_first(${list})` : s.which === 'last' ? `_first(${list}[::-1])` : `_first(_where(${list}, ${pyPath(s.which.key)}, ${py(s.which.equals)}))`;
      return chain(s.field.length ? `_get(${item}, ${pyPath(s.field)})` : item, ts);
    }
    case 'values': {
      const list = `_list(_get(${ctx}, ${pyPath(s.array)}))`;
      const each = s.field.length ? `_get(it, ${pyPath(s.field)})` : 'it';
      return `[v for v in (${chain(each, ts)} for it in ${list}) if v is not None]`;
    }
    case 'count': return chain(`len(_list(_get(${ctx}, ${pyPath(s.array)})))`, ts);
    case 'constant': return chain(py(s.value), ts);
    case 'nested': {
      const inner = objectExpr(s.fields, 'item', indent + '    ');
      return `[o for o in (${inner} for item in _list(_get(${ctx}, ${pyPath(s.array)}))) if o is not None]`;
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
    const parts = [...n.children.entries()].map(([k, c]) => `${ind}    ${JSON.stringify(k)}: ${c.expr ?? render(c, ind + '    ')},`);
    return `_obj({\n${parts.join('\n')}\n${ind}})`;
  };
  return render(root, indent);
}

export function compilePython(fields: FieldMapping[], header = ''): string {
  return `${header ? header.split('\n').map((l) => `# ${l}`.trimEnd()).join('\n') + '\n' : ''}${PYTHON_HELPERS}

def map_record(r):
    return ${objectExpr(fields, 'r', '    ')}


def map_records(records):
    return [m for m in (map_record(r) for r in records) if m is not None]


def to_dataframe(records):
    """One row per record; nested fields become dotted columns. Needs pandas."""
    import pandas as pd

    return pd.json_normalize(map_records(records))


if __name__ == "__main__":
    import sys

    data = json.load(sys.stdin)
    json.dump(map_records(data if isinstance(data, list) else [data]), sys.stdout)
`;
}
