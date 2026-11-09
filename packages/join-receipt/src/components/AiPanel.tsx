import { DEFAULTS, type ModelConfig } from '@data-tools/core';

export interface AiState extends ModelConfig { enabled: boolean; mode: 'masked' | 'raw' }
export const defaultAi: AiState = { enabled: false, kind: 'anthropic', ...DEFAULTS.anthropic, apiKey: '', mode: 'masked' };

export function AiPanel({ ai, setAi }: { ai: AiState; setAi: (a: AiState) => void }) {
  const set = (p: Partial<AiState>) => setAi({ ...ai, ...p });
  return (
    <section className="ai" aria-labelledby="ai-h">
      <h2 id="ai-h">Get a drafted fix (optional)</h2>
      <p>
        Off until you turn it on. A model can suggest cleanups the rules missed, but it can only pick from a fixed list of
        operations, and every suggestion gets run and scored on your data before you see it. It never writes SQL and never
        produces a number.
      </p>
      <label className="check">
        <input type="checkbox" checked={ai.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Let me draft fixes with a model
      </label>
      {ai.enabled && (
        <div className="ai-form">
          <label>Provider
            <select value={ai.kind} onChange={(e) => { const kind = e.target.value as AiState['kind']; set({ kind, ...DEFAULTS[kind] }); }}>
              <option value="anthropic">Anthropic (your API key)</option>
              <option value="openai-compatible">OpenAI-compatible (Ollama, OpenAI, local servers)</option>
            </select>
          </label>
          <label>Endpoint<input value={ai.endpoint} onChange={(e) => set({ endpoint: e.target.value })} spellCheck={false} /></label>
          <label>Model<input value={ai.model} onChange={(e) => set({ model: e.target.value })} spellCheck={false} /></label>
          <label>API key {ai.kind === 'openai-compatible' && <span className="muted">(not needed for Ollama)</span>}
            <input type="password" value={ai.apiKey} onChange={(e) => set({ apiKey: e.target.value })} autoComplete="off" spellCheck={false} />
          </label>
          <p className="muted">Your key stays in this tab's memory. It's never saved, and it's gone when you close the tab.</p>
          {ai.kind === 'openai-compatible' && (
            <p className="muted">Ollama only answers pages it trusts. Start it with <code>OLLAMA_ORIGINS={window.location.origin} ollama serve</code>.</p>
          )}
          <label className="check">
            <input type="checkbox" checked={ai.mode === 'raw'} onChange={(e) => set({ mode: e.target.checked ? 'raw' : 'masked' })} />
            Send real sample values (by default they're masked: 01001 goes out as 99999)
          </label>
        </div>
      )}
    </section>
  );
}
