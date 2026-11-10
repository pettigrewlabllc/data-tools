/**
 * Python that runs in the user's own environment (ADR 0007: no bundled Python, only snippets).
 * PREFLIGHT runs once with the Python beside `jupyter`; HELPER is pasted into the instrumented
 * notebook's first cell. Neither prints anything, so user cell outputs are unchanged.
 */

/** Reads [{"source": str}] on stdin; writes [{stores, loads, strings, error}] on stdout. */
/** Reads [{"source": str}] on stdin; writes one record per cell on stdout (see CellInfo). */
export const PREFLIGHT = String.raw`
import ast, json, re, sys

READERS = {"read_csv", "read_parquet", "read_json", "read_excel", "read_table", "read_feather", "read_pickle",
           "read_fwf", "read_orc", "read_stata", "read_sas", "read_spss", "read_hdf", "loadtxt", "genfromtxt",
           "load", "read_text", "read_bytes", "imread", "read_file", "scan_csv", "scan_parquet"}
WRITERS = {"to_csv", "to_parquet", "to_json", "to_excel", "to_feather", "to_pickle", "to_html", "to_markdown",
           "to_stata", "to_hdf", "savefig", "save", "savez", "savez_compressed", "savetxt", "write_text",
           "write_bytes", "imsave", "write_csv", "write_parquet", "to_file"}

def call_name(f):
    if isinstance(f, ast.Attribute):
        return f.attr
    if isinstance(f, ast.Name):
        return f.id
    return None

def str_args(node):
    out = []
    for a in node.args[:1]:
        if isinstance(a, ast.Constant) and isinstance(a.value, str):
            out.append(a.value)
    for k in node.keywords:
        if k.arg in ("path", "path_or_buf", "filepath_or_buffer", "fname", "file", "io", "excel_writer", "path_or_buffer") \
                and isinstance(k.value, ast.Constant) and isinstance(k.value.value, str):
            out.append(k.value.value)
    return out

cells = json.load(sys.stdin)
out = []
for c in cells:
    src = c["source"]
    rec = {"stores": [], "loads": [], "reads": [], "writes": [], "funcs": {}, "imports": False, "error": None}
    if src.lstrip().startswith("%%"):
        rec["error"] = "cell magic"
        out.append(rec)
        continue
    # Line magics and shell escapes aren't Python; keep indentation so blocks still parse.
    lines = [re.sub(r"^(\s*)[%!].*$", r"\1pass", l) for l in src.split("\n")]
    try:
        tree = ast.parse("\n".join(lines))
    except SyntaxError as e:
        rec["error"] = "syntax error line %s" % e.lineno
        out.append(rec)
        continue
    def add(lst, n):
        if n not in lst:
            lst.append(n)
    class V(ast.NodeVisitor):
        def __init__(self):
            self.local = 0     # inside a lambda or comprehension: stores there are local
            self.func = None   # name of the top-level function whose body we're in
        def target(self):
            return rec["funcs"][self.func] if self.func else rec["loads"]
        def visit_Name(self, node):
            if isinstance(node.ctx, ast.Load):
                add(self.target(), node.id)
            elif self.local == 0 and self.func is None:
                add(rec["stores"], node.id)
        def visit_AugAssign(self, node):
            if isinstance(node.target, ast.Name):
                add(self.target(), node.target.id)
            self.generic_visit(node)
        def visit_Import(self, node):
            rec["imports"] = True
            if self.func is None:
                for a in node.names:
                    add(rec["stores"], a.asname or a.name.split(".")[0])
        visit_ImportFrom = visit_Import
        def visit_FunctionDef(self, node):
            if self.func is not None:
                self.generic_visit(node)
                return
            add(rec["stores"], node.name)
            rec["funcs"].setdefault(node.name, [])
            self.func = node.name
            self.generic_visit(node)
            self.func = None
        visit_AsyncFunctionDef = visit_FunctionDef
        def visit_ClassDef(self, node):
            if self.func is None:
                add(rec["stores"], node.name)
            self.generic_visit(node)
        def _local(self, node):
            self.local += 1
            self.generic_visit(node)
            self.local -= 1
        visit_Lambda = visit_ListComp = visit_SetComp = visit_DictComp = visit_GeneratorExp = _local
        def visit_Global(self, node):
            for n in node.names:
                add(rec["stores"], n)
        def visit_Call(self, node):
            name = call_name(node.func)
            if name in READERS:
                for p in str_args(node): add(rec["reads"], p)
            elif name in WRITERS:
                for p in str_args(node): add(rec["writes"], p)
            elif name == "open":
                mode = None
                if len(node.args) > 1 and isinstance(node.args[1], ast.Constant):
                    mode = node.args[1].value
                for k in node.keywords:
                    if k.arg == "mode" and isinstance(k.value, ast.Constant):
                        mode = k.value.value
                writes = isinstance(mode, str) and any(ch in mode for ch in "wax+")
                for p in str_args(node): add(rec["writes" if writes else "reads"], p)
            self.generic_visit(node)
    V().visit(tree)
    out.append(rec)
json.dump(out, sys.stdout)
`;

/** Defines _dp_pre / _dp_post. The log path and notebook folder are filled in per run. */
export const HELPER = String.raw`
import hashlib as _dp_hashlib, json as _dp_json, os as _dp_os, re as _dp_re, time as _dp_time, types as _dp_types
_dp_os.chdir(__DP_DIR__)
_dp_LOG = __DP_LOG__
_dp_M128 = (1 << 128) - 1
_dp_ADDR = _dp_re.compile(r" at 0x[0-9a-fA-F]+")

def _dp_h(b):
    return _dp_hashlib.sha256(b if isinstance(b, bytes) else str(b).encode("utf-8", "surrogatepass")).hexdigest()

def _dp_tag(kind, rows, n):
    return _dp_h("%s:%d:%x" % (kind, rows, n))[:32]

def _dp_fp_lines(items, order_matters, rounded=None):
    # items: list of canonical strings. rounded: same with floats cut to 10 significant digits.
    o = _dp_hashlib.sha256()
    u = 0
    r = 0
    for i, s in enumerate(items):
        d = _dp_hashlib.sha256(s.encode("utf-8", "surrogatepass")).digest()
        o.update(d)
        u = (u + int.from_bytes(d[:16], "big")) & _dp_M128
        rs = rounded[i] if rounded is not None else s
        r = (r + int.from_bytes(_dp_hashlib.sha256(rs.encode("utf-8", "surrogatepass")).digest()[:16], "big")) & _dp_M128
    n = len(items)
    return {"rows": n, "ordered": o.hexdigest()[:32], "unordered": _dp_tag("u", n, u), "rounded": _dp_tag("r", n, r),
            "columns": {}, "order_matters": order_matters}

def _dp_round_num(x):
    try:
        if isinstance(x, float) and x == x and x not in (float("inf"), float("-inf")) and not x.is_integer():
            return "%.10g" % x
    except Exception:
        pass
    return None

def _dp_scalar(v):
    s = _dp_ADDR.sub(" at 0x?", repr(v))
    rv = _dp_round_num(float(v)) if type(v).__name__ in ("float", "float64", "float32", "float16") else None
    return s, (rv if rv is not None else s)

def _dp_frame(df, order_matters=True):
    import numpy as np
    import pandas as pd
    def hashable(frame):
        # hash_pandas_object can't take lists/dicts in object columns; use their masked text instead.
        f = frame.copy()
        for c in f.columns:
            try:
                pd.util.hash_pandas_object(f[c].head(50), index=False)
            except (TypeError, ValueError):
                f[c] = f[c].map(lambda x: _dp_ADDR.sub(" at 0x?", repr(x)))
        return f
    def rowhash(frame):
        try:
            return pd.util.hash_pandas_object(frame, index=False).to_numpy(dtype="uint64")
        except (TypeError, ValueError):
            return pd.util.hash_pandas_object(frame.astype(str), index=False).to_numpy(dtype="uint64")
    def rounded_frame(frame):
        f = frame.copy()
        for c in f.columns:
            col = f[c]
            if pd.api.types.is_float_dtype(col):
                x = col.to_numpy(dtype="float64")
                with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
                    mag = np.where((x == 0) | ~np.isfinite(x), 0, np.floor(np.log10(np.abs(x))))
                    scale = np.power(10.0, 9 - mag)
                    f[c] = np.where(np.isfinite(x), np.round(x * scale) / scale, x)
        return f
    def summed(h):
        # Sum of 64-bit digests mod 2^128 without numpy overflow: add the 32-bit halves separately.
        h = np.asarray(h, dtype="uint64")
        lo = int((h & np.uint64(0xFFFFFFFF)).astype("uint64").sum(dtype="uint64")) if len(h) < 2**31 else sum(int(x) & 0xFFFFFFFF for x in h)
        hi = int((h >> np.uint64(32)).astype("uint64").sum(dtype="uint64")) if len(h) < 2**31 else sum(int(x) >> 32 for x in h)
        return ((hi << 32) + lo) & _dp_M128
    df = hashable(df)
    df.columns = [str(c) for c in df.columns]
    h = rowhash(df)
    n = len(df)
    cols = {}
    for c in df.columns:
        cols[c] = _dp_tag("c" + c, n, summed(rowhash(df[[c]])))
    idx = pd.DataFrame({"i": df.index})
    cols["(index)"] = _dp_tag("i", n, summed(rowhash(hashable(idx))))
    schema = _dp_h(_dp_json.dumps([[c, str(t)] for c, t in zip(df.columns, df.dtypes)]))[:16]
    return {"rows": n, "ordered": _dp_h(schema.encode() + h.tobytes())[:32],
            "unordered": _dp_tag("u" + schema, n, summed(h)),
            "rounded": _dp_tag("r" + schema, n, summed(rowhash(rounded_frame(df)))),
            "columns": cols, "order_matters": order_matters}

def _dp_fp(v, depth=0):
    """Fingerprint of a value, or None when it isn't data (modules, functions, classes)."""
    if isinstance(v, (_dp_types.ModuleType, _dp_types.FunctionType, _dp_types.BuiltinFunctionType, type, _dp_types.MethodType)):
        return None
    tn = type(v).__module__ + "." + type(v).__name__
    try:
        import pandas as pd
        if isinstance(v, pd.DataFrame):
            return _dp_frame(v)
        if isinstance(v, pd.Series):
            return _dp_frame(v.to_frame(name=str(v.name)))
        if isinstance(v, pd.Index):
            return _dp_frame(pd.DataFrame({"index": v}))
    except ImportError:
        pass
    try:
        import numpy as np
        if isinstance(v, np.ndarray):
            import pandas as pd
            a = v.reshape(len(v), -1) if v.ndim >= 1 and len(v) else v.reshape(1, -1)
            return _dp_frame(pd.DataFrame(a))
    except ImportError:
        pass
    if isinstance(v, (str, bytes, int, float, complex, bool, type(None))) or tn.startswith("numpy.") or tn.startswith("pandas._libs"):
        s, r = _dp_scalar(v)
        return _dp_fp_lines([s], True, [r])
    if depth < 3 and isinstance(v, (list, tuple, set, frozenset, dict)):
        if isinstance(v, dict):
            items = list(v.items())
            enc = [_dp_elem(k, depth) + "=" + _dp_elem(x, depth) for k, x in items]
            return _dp_fp_lines(enc, False)
        enc = [_dp_elem(x, depth) for x in v]
        return _dp_fp_lines(enc, isinstance(v, (list, tuple)))
    s = _dp_ADDR.sub(" at 0x?", repr(v))
    if _dp_re.match(r"^<.* at 0x\?>$", s):
        return {"rows": 0, "ordered": "", "unordered": "", "rounded": "", "columns": {}, "order_matters": False,
                "skipped": "no data view of " + type(v).__name__}
    return _dp_fp_lines([s], True)

def _dp_elem(x, depth):
    f = _dp_fp(x, depth + 1)
    if f is None:
        return "?"
    if f.get("skipped"):
        return "skipped"
    return f["ordered"] if f["order_matters"] else f["unordered"]

def _dp_file(p):
    try:
        with open(p, "rb") as fh:
            return _dp_h(fh.read())[:32]
    except Exception:
        return None

def _dp_snap(names):
    g = globals()
    out = {}
    for n in names:
        if n in g and not n.startswith("_dp_"):
            try:
                f = _dp_fp(g[n])
            except Exception as e:
                f = {"rows": 0, "ordered": "", "unordered": "", "rounded": "", "columns": {}, "order_matters": False,
                     "skipped": "could not fingerprint (%s)" % type(e).__name__}
            if f is not None:
                out[n] = f
    return out

def _dp_write(rec):
    with open(_dp_LOG, "a") as fh:
        fh.write(_dp_json.dumps(rec) + "\n")

def _dp_pre(cell, names, files):
    _dp_write({"cell": cell, "phase": "pre", "t": _dp_time.perf_counter(), "vars": _dp_snap(names),
               "files": {p: _dp_file(p) for p in files}})

def _dp_post(cell, names, files):
    _dp_write({"cell": cell, "phase": "post", "t": _dp_time.perf_counter(), "vars": _dp_snap(names),
               "files": {p: _dp_file(p) for p in files}})
`;
