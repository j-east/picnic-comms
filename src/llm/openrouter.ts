import { config } from '../config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Minimal OpenRouter chat call. One model, configurable by env. */
export async function chat(messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openrouter.apiKey}`,
      'HTTP-Referer': config.publicUrl,
      'X-Title': 'Picnic Comms',
    },
    body: JSON.stringify({
      model: config.openrouter.model,
      messages,
      max_tokens: opts.maxTokens ?? 4000,
      temperature: opts.temperature ?? 0.3,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('OpenRouter returned no content');
  return content;
}

/** Models fence JSON or add a preamble now and then; find the object. */
export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`No JSON object in model output: ${text.slice(0, 200)}`);
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
