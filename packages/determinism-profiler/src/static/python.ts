import type { Cause, Finding } from '../types.js';

interface Rule {
  cause: Cause;
  kind: Finding['kind'];
  re: RegExp;
  /** Return false to drop a match (e.g. it passes a seed). `call` is the text from the match to its closing paren. */
  keep?: (call: string, ctx: { seeded: boolean; line: string }) => boolean;
}

const hasSeedArg = (call: string) => /\brandom_state\s*=\s*(?!None\b)/.test(call) || /\bseed\s*=\s*(?!None\b)/.test(call);

const RULES: Rule[] = [
  { cause: 'timestamp', kind: 'definite', re: /\b(?:datetime\.)?(?:datetime|date)\.(?:now|today|utcnow)\s*\(|\btime\.time\s*\(|\b(?:pd\.)?Timestamp\.(?:now|today|utcnow)\s*\(|\bTimestamp\(\s*['"](?:now|today)['"]|\bpd\.to_datetime\(\s*['"](?:now|today)['"]/ },
  { cause: 'random', kind: 'definite', re: /\b(?:np|numpy)\.random\.(?:rand|randn|randint|random|random_sample|choice|shuffle|permutation|normal|uniform|binomial|poisson|exponential|beta|gamma|integers)\s*\(/, keep: (_c, x) => !x.seeded },
  { cause: 'random', kind: 'definite', re: /(?<![\w.])random\.(?:random|randint|randrange|choice|choices|shuffle|sample|uniform|gauss)\s*\(/, keep: (_c, x) => !x.seeded },
  { cause: 'random', kind: 'definite', re: /\bdefault_rng\s*\(\s*\)/ },
  { cause: 'random', kind: 'definite', re: /\buuid\.uuid4\s*\(/ },
  // pandas' .sample(random_state=None) draws from numpy's global RNG, so a global seed makes it repeatable.
  { cause: 'unseeded_sample', kind: 'definite', re: /\.sample\s*\(/, keep: (c, x) => !hasSeedArg(c) && !x.seeded && !/^\s*(?:random)\.sample/.test(x.line) },
  { cause: 'unseeded_sample', kind: 'definite', re: /\btrain_test_split\s*\(/, keep: (c) => !hasSeedArg(c) },
  { cause: 'unseeded_sample', kind: 'definite', re: /(?<![\w.])shuffle\s*\(/, keep: (c) => !hasSeedArg(c) },
  { cause: 'unseeded_sample', kind: 'definite', re: /\b(?:KFold|StratifiedKFold|ShuffleSplit|RandomForest\w*|ExtraTrees\w*|KMeans|GradientBoosting\w*|IsolationForest|TSNE|MiniBatchKMeans)\s*\(/, keep: (c) => !hasSeedArg(c) && !/\bshuffle\s*=\s*False/.test(c) },
  { cause: 'ties', kind: 'candidate', re: /\.sort_values\s*\([^)]*\)\s*\.head\s*\(|\.nlargest\s*\(|\.nsmallest\s*\(/ },
  { cause: 'set_order', kind: 'candidate', re: /(?<!sorted\(|len\(|sorted\(\s|len\(\s)\b(?:list|tuple)\s*\(\s*set\s*\(|\bfor\s+\w+\s+in\s+set\s*\(|['"]\s*\.join\s*\(\s*set\s*\(/ },
  { cause: 'ai_step', kind: 'judgment', re: /\.chat\.completions\.create\s*\(|\.messages\.create\s*\(|\bgenerate_content\s*\(|\bollama\.(?:chat|generate)\s*\(|\blitellm\.completion\s*\(|\.responses\.create\s*\(/ },
];

const SEED = /\b(?:np|numpy)\.random\.seed\s*\(|(?<![\w.])random\.seed\s*\(|\btorch\.manual_seed\s*\(|\bset_seed\s*\(|\bseed_everything\s*\(/;

/** Text from `start` to the paren that closes the first '(' at or after it (across lines). */
function callText(src: string, start: number): string {
  const open = src.indexOf('(', start);
  if (open < 0) return src.slice(start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** Blank out comments and string contents so patterns don't match inside them, keeping offsets. */
function codeOnly(src: string): string {
  return src.replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|#[^\n]*)/g, (m) => {
    if (m.startsWith('#')) return ' '.repeat(m.length);
    // keep quotes and the strings 'now'/'today' (Timestamp('now')), blank the rest
    if (/^['"](now|today)['"]$/.test(m)) return m;
    return m[0] + m.slice(1, -1).replace(/[^\n]/g, ' ') + m[m.length - 1];
  });
}

export interface PyState {
  seeded: boolean;
}

/** Checks one notebook code cell. `cell` is the 1-based code-cell number. */
export function checkCell(src: string, file: string, cell: number, step: string, state: PyState): Finding[] {
  const code = codeOnly(src);
  const out: Finding[] = [];
  const lineAt = (i: number) => code.slice(0, i).split('\n').length;
  // A seed call anywhere earlier in this cell counts from that line on.
  const seedAt = (() => { const m = SEED.exec(code); return m ? m.index : -1; })();
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, 'g');
    for (let m; (m = re.exec(code)); ) {
      const seeded = state.seeded || (seedAt >= 0 && seedAt < m.index);
      const line = code.split('\n')[lineAt(m.index) - 1] ?? '';
      if (rule.keep && !rule.keep(callText(code, m.index), { seeded, line })) continue;
      const kw = m[0].replace(/\s*\($/, '').replace(/^[.\s'"]+/, '').slice(0, 40);
      out.push({ file, line: lineAt(m.index), cell, cause: rule.cause, keyword: kw, kind: rule.kind, step, status: 'pending' });
    }
  }
  if (seedAt >= 0) state.seeded = true;
  // One finding per cause per line is enough.
  const seen = new Set<string>();
  return out.filter((f) => { const k = `${f.line}:${f.cause}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
