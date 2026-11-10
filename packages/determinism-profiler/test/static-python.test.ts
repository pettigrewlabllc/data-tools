import { describe, expect, it } from 'vitest';
import { checkCell } from '../src/static/python.js';

const causes = (src: string, seeded = false) => checkCell(src, 'nb.ipynb', 1, 'cell-1', { seeded }).map((f) => `${f.cause}@${f.line}`);

describe('Python cell checks', () => {
  it('flags unseeded samples and passes seeded ones', () => {
    expect(causes('s = df.sample(frac=0.5)')).toEqual(['unseeded_sample@1']);
    expect(causes('s = df.sample(\n  frac=0.5,\n  random_state=1)')).toEqual([]);
    expect(causes('s = df.sample(frac=0.5, random_state=None)')).toEqual(['unseeded_sample@1']);
    expect(causes('np.random.seed(0)\ns = df.sample(5)')).toEqual([]);
    expect(causes('s = df.sample(5)', true)).toEqual([]);
  });
  it('flags timestamps, unseeded random and model calls', () => {
    expect(causes("t = datetime.now()\nu = pd.Timestamp('now')\nv = time.time()")).toEqual(['timestamp@1', 'timestamp@2', 'timestamp@3']);
    expect(causes('x = np.random.rand(3)\nrng = np.random.default_rng()')).toEqual(['random@1', 'random@2']);
    expect(causes('rng = np.random.default_rng(42)')).toEqual([]);
    expect(causes("r = client.messages.create(model='m')")).toEqual(['ai_step@1']);
  });
  it('sklearn: random_state counts as a seed', () => {
    expect(causes('a, b = train_test_split(X)\nm = RandomForestClassifier()')).toEqual(['unseeded_sample@1', 'unseeded_sample@2']);
    expect(causes('a, b = train_test_split(X, random_state=0)\nX = shuffle(X, random_state=0)')).toEqual([]);
  });
  it('sets: list(set()) is a candidate, sorted(set()) is fine', () => {
    expect(causes('r = list(set(names))')).toEqual(['set_order@1']);
    expect(causes('r = sorted(set(names))\nn = len(set(names))')).toEqual([]);
  });
  it('ignores comments and strings', () => {
    expect(causes("# df.sample(5)\nlabel = 'datetime.now()'")).toEqual([]);
  });
});
