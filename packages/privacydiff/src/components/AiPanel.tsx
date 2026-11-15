import { DEFAULTS, noticeRequest, redact, type ModelConfig } from '@data-tools/core';
import { C } from '../copy';

export interface AiState extends ModelConfig { enabled: boolean }
export const defaultAi: AiState = { enabled: false, kind: 'anthropic', ...DEFAULTS.anthropic, apiKey: '' };

export function AiPanel({ ai, setAi, notice, busy, message, onRun }: {
  ai: AiState; setAi: (a: AiState) => void; notice: string; busy: boolean; message: string; onRun: () => void;
}) {
  const set = (p: Partial<AiState>) => setAi({ ...ai, ...p });
  const req = ai.enabled ? noticeRequest(ai, notice) : null;
  const shown = req ? JSON.stringify({ url: req.url, headers: redact(req.headers), body: req.body }, null, 2) : '';
  const ready = ai.enabled && notice.trim() && (ai.kind === 'openai-compatible' || ai.apiKey);
  return (
    <section className="ai" aria-labelledby="ai-h">
      <h3 id="ai-h">{C.aiHeading}</h3>
      <p>{C.aiHelp}</p>
      <label className="check">
        <input type="checkbox" checked={ai.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        {C.aiEnable}
      </label>
      {ai.enabled && (
        <div className="ai-form">
          <label>{C.aiProvider}
            <select value={ai.kind} onChange={(e) => { const kind = e.target.value as AiState['kind']; set({ kind, ...DEFAULTS[kind] }); }}>
              <option value="anthropic">{C.aiAnthropic}</option>
              <option value="openai-compatible">{C.aiOpenAi}</option>
            </select>
          </label>
          <label>{C.aiEndpoint}<input value={ai.endpoint} onChange={(e) => set({ endpoint: e.target.value })} spellCheck={false} /></label>
          <label>{C.aiModel}<input value={ai.model} onChange={(e) => set({ model: e.target.value })} spellCheck={false} /></label>
          <label>{C.aiKey}<input type="password" value={ai.apiKey} onChange={(e) => set({ apiKey: e.target.value })} autoComplete="off" spellCheck={false} /></label>
          <p className="muted">{C.aiKeyNote}</p>
          <div className="payload">
            <h4>{C.aiPayloadHeading}</h4>
            <p className="muted">{C.aiPayloadHelp}</p>
            <pre tabIndex={0} aria-label={C.aiPayloadHeading} data-testid="ai-notice">{notice || C.aiNoNotice}</pre>
            <details><summary>{C.aiRequestSummary}</summary><pre tabIndex={0}>{shown}</pre></details>
          </div>
          <button className="primary" disabled={!ready || busy} onClick={onRun}>{busy ? C.aiRunning : C.aiRun}</button>
          {message && <p role="status" className="muted">{message}</p>}
        </div>
      )}
    </section>
  );
}
