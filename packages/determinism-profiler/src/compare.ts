import { identity, type Fingerprint } from './fingerprint.js';
import type { Finding, Report, StepResult, Trace, TraceStep, Verdict } from './types.js';

const RANK: Record<Verdict, number> = { same: 0, skipped: 0, order: 1, float: 2, values: 3, rows: 4, error: 5 };
export const worst = (a: Verdict, b: Verdict): Verdict => (RANK[b] > RANK[a] ? b : a);

/** Verdict for one output across runs (§2 of the design spec). */
export function outputVerdict(fps: (Fingerprint | undefined)[]): { verdict: Verdict; columns: string[] } {
  if (fps.some((f) => f === undefined)) return { verdict: fps.every((f) => f === undefined) ? 'same' : 'values', columns: [] };
  const all = fps as Fingerprint[];
  if (all.every((f) => f.skipped)) return { verdict: 'skipped', columns: [] };
  const eq = (k: keyof Fingerprint) => all.every((f) => f[k] === all[0][k]);
  const orderMatters = all[0].order_matters;
  const columns = Object.keys(all[0].columns).filter((c) => !all.every((f) => f.columns[c] === all[0].columns[c]));
  if (!eq('rows')) return { verdict: 'rows', columns };
  if (eq('unordered')) return { verdict: orderMatters && !eq('ordered') ? 'order' : 'same', columns: [] };
  if (eq('rounded')) return { verdict: 'float', columns };
  return { verdict: 'values', columns };
}

/** Input ids look like "<step_id>#<output>"; the producing step is the part before '#'. */
export const producerOf = (inputId: string) => inputId.split('#')[0];

export function compareRuns(traces: Trace[], findings: Finding[]): Pick<Report, 'steps' | 'sources' | 'score' | 'findings'> {
  const first = traces[0];
  const byId = traces.map((t) => new Map(t.steps.map((s) => [s.step_id, s])));
  const results = new Map<string, StepResult>();

  for (const s0 of first.steps) {
    const runs = byId.map((m) => m.get(s0.step_id)).filter((s): s is TraceStep => !!s);
    const outputNames = [...new Set(runs.flatMap((r) => Object.keys(r.outputs)))];
    // Failing in some runs but not others (or failing differently) is itself a difference.
    const errs = runs.map((r) => (r.status === 'error' ? r.error ?? 'error' : ''));
    let verdict: Verdict = errs.every((e) => e === errs[0]) ? 'same' : 'error';
    const moved: StepResult['moved'] = [];
    if (verdict !== 'error') {
      let anyHashable = outputNames.length === 0;
      for (const name of outputNames) {
        const v = outputVerdict(runs.map((r) => r.outputs[name]));
        if (v.verdict !== 'skipped') anyHashable = true;
        if (v.verdict !== 'same' && v.verdict !== 'skipped') moved.push({ output: name, ...v });
        verdict = worst(verdict, v.verdict);
      }
      if (!anyHashable) verdict = 'skipped';
    }
    const inputIds = [...new Set(runs.flatMap((r) => Object.keys(r.input_hashes)))];
    const changed = inputIds.filter((id) => !runs.every((r) => r.input_hashes[id] === runs[0].input_hashes[id]));

    let attribution: StepResult['attribution'] = 'none';
    const from = new Set<string>();
    if (verdict !== 'same' && verdict !== 'skipped' && s0.kind !== 'source') {
      if (changed.length === 0) attribution = 'origin';
      else {
        let fromSource = false;
        // Walk back through changed inputs to the steps that started it. A producer that didn't move
        // itself (it only passed the input along) is walked through, not stopped at.
        const seen = new Set<string>();
        const walk = (id: string) => {
          const p = results.get(producerOf(id));
          if (!p || seen.has(p.step_id)) return;
          seen.add(p.step_id);
          if (p.kind === 'source') { fromSource = true; from.add(p.step_id); }
          else if (p.attribution === 'origin') from.add(p.step_id);
          else if (p.from.length) { p.from.forEach((x) => from.add(x)); if (p.attribution === 'inconclusive') fromSource = true; }
          else p.changed_inputs.forEach(walk);
        };
        changed.forEach(walk);
        attribution = fromSource ? 'inconclusive' : 'inherited';
      }
    }
    results.set(s0.step_id, {
      step_id: s0.step_id,
      kind: s0.kind,
      label: s0.label,
      location: s0.location,
      verdict,
      attribution,
      judgment: runs.some((r) => r.judgment),
      moved,
      from: [...from],
      changed_inputs: changed,
      rows: runs.map((r) => Math.max(0, ...Object.values(r.outputs).filter((f) => !f.skipped).map((f) => f.rows))),
      findings: [],
      duration_ms: runs.map((r) => r.duration_ms),
    });
  }

  // Findings: settle their status against what the runs showed.
  const out: Finding[] = [];
  for (const f of findings) {
    const r = results.get(f.step);
    const g = { ...f };
    if (!r) g.status = f.kind === 'candidate' ? 'candidate' : 'latent';
    else if (r.attribution === 'origin') {
      const hasDefinite = r && findings.some((x) => x.step === f.step && x.kind === 'definite');
      g.status = f.kind === 'candidate' && hasDefinite ? 'candidate' : 'confirmed';
    } else if (r.attribution === 'inherited' || r.attribution === 'inconclusive') g.status = 'upstream';
    else g.status = f.kind === 'candidate' ? 'candidate' : 'latent';
    out.push(g);
    r?.findings.push(g);
  }
  for (const r of results.values()) {
    if (r.attribution === 'origin' && r.verdict === 'float') {
      const g: Finding = {
        file: r.location.file, line: r.location.line ?? 1, cell: r.location.cell, cause: 'float_order',
        keyword: 'float', kind: 'runtime', step: r.step_id, status: 'confirmed',
      };
      r.findings.push(g);
      out.push(g);
    }
  }

  // The same place can be reported twice (a function body and its call). Keep the strongest reading.
  const RANKS = { confirmed: 4, upstream: 3, latent: 2, candidate: 1, pending: 0 } as const;
  const best = new Map<string, Finding>();
  for (const f of out) {
    const k = `${f.file}|${f.cell ?? ''}|${f.line}|${f.cause}`;
    const prev = best.get(k);
    if (!prev || RANKS[f.status] > RANKS[prev.status]) best.set(k, f);
  }
  const kept = new Set(best.values());
  for (const r of results.values()) r.findings = r.findings.filter((f) => kept.has(f));
  const all = [...results.values()];
  const steps = all.filter((r) => r.kind !== 'source');
  const sources = all.filter((r) => r.kind === 'source');
  const scored = steps.filter((r) => !r.judgment && r.verdict !== 'skipped');
  const same = scored.filter((r) => r.verdict === 'same').length;
  return {
    steps,
    sources,
    findings: out.filter((f) => kept.has(f)),
    score: { same, scored: scored.length, percent: scored.length ? Math.round((1000 * same) / scored.length) / 10 : 100 },
  };
}
