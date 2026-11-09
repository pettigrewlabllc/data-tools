import { PROMPT } from './prompt';
import type { Payload } from './payload';

export interface ModelConfig {
  kind: 'anthropic' | 'openai-compatible';
  endpoint: string;   // e.g. https://api.anthropic.com or http://localhost:11434/v1
  model: string;
  apiKey: string;     // kept in memory only
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export const DEFAULTS: Record<ModelConfig['kind'], { endpoint: string; model: string }> = {
  anthropic: { endpoint: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' },
  'openai-compatible': { endpoint: 'http://localhost:11434/v1', model: 'llama3.1' },
};

/** The exact HTTP request a call would make, so the payload panel can show it (key redacted). */
export function buildRequest(cfg: ModelConfig, payload: Payload): { url: string; headers: Record<string, string>; body: unknown } {
  const user = JSON.stringify(payload);
  const base = cfg.endpoint.replace(/\/+$/, '');
  if (cfg.kind === 'anthropic') {
    return {
      url: `${base}/v1/messages`,
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: { model: cfg.model, max_tokens: 1024, system: PROMPT, messages: [{ role: 'user', content: user }] },
    };
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  return {
    url: `${base}/chat/completions`,
    headers,
    body: { model: cfg.model, max_tokens: 1024, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: user }] },
  };
}

export function redact(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = /key|authorization/i.test(k) && v ? '•••• (your key, never stored)' : v;
  return out;
}

/** Pull the first JSON object out of a model's text. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('the model did not return JSON');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('the model returned incomplete JSON');
}

export async function callModel(cfg: ModelConfig, payload: Payload, f: Fetcher = (u, i) => fetch(u, i)): Promise<unknown> {
  const req = buildRequest(cfg, payload);
  const res = await f(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try { const j = JSON.parse(text); msg = j?.error?.message ?? j?.error ?? msg; } catch { /* keep raw */ }
    throw new Error(`model request failed (${res.status}): ${String(msg)}`);
  }
  const j = JSON.parse(text);
  const content = cfg.kind === 'anthropic'
    ? (j.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('')
    : j.choices?.[0]?.message?.content ?? '';
  return extractJson(String(content));
}
