import 'server-only';
import { ALL_CATEGORIES, ALL_METHODS } from '@/lib/types';

/* ===========================================================================
   Where entry parsing gets its intelligence.

   The local parser handles most phrasing for free, so a model is a FALLBACK
   for what it cannot read, not the primary path. That makes the provider a
   detail rather than a dependency: the feature works with none configured.

   Providers are chosen by environment, and almost every free option speaks the
   OpenAI chat-completions shape — Groq, OpenRouter, Together, Mistral, and a
   local Ollama all do — so one adapter covers them. Google Gemini uses its own
   shape and gets a second, small adapter.

     ENTRY_AI=off                      local parser only (the default)
     ENTRY_AI=openai-compatible        + ENTRY_AI_BASE_URL, ENTRY_AI_KEY, ENTRY_AI_MODEL
     ENTRY_AI=gemini                   + GEMINI_API_KEY [, ENTRY_AI_MODEL]
     ENTRY_AI=anthropic                + ANTHROPIC_API_KEY

   Known-free setups, for reference:

     Groq        https://api.groq.com/openai/v1   llama-3.3-70b-versatile
     OpenRouter  https://openrouter.ai/api/v1     any model id ending ":free"
     Gemini      (no base url needed)             gemini-2.0-flash
     Ollama      http://localhost:11434/v1        llama3.2   (no key, fully local)

   Nothing here decides anything financial. It returns a suggestion that the
   caller sanitises against the app's own lists and the user then confirms.
   =========================================================================== */

export type ProviderName = 'off' | 'openai-compatible' | 'gemini' | 'anthropic';

export type ProviderConfig = {
  name: ProviderName;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  /** Shown in the UI so the source of a suggestion is never a mystery. */
  label: string;
};

export function providerConfig(): ProviderConfig {
  const requested = (process.env.ENTRY_AI ?? '').trim().toLowerCase() as ProviderName;

  if (requested === 'openai-compatible') {
    const baseUrl = process.env.ENTRY_AI_BASE_URL?.replace(/\/$/, '');
    const model = process.env.ENTRY_AI_MODEL ?? '';
    // A local Ollama needs no key; a hosted provider does.
    const apiKey = process.env.ENTRY_AI_KEY ?? '';
    if (baseUrl && model) {
      return { name: 'openai-compatible', baseUrl, apiKey, model, label: hostLabel(baseUrl, model) };
    }
  }

  if (requested === 'gemini' && process.env.GEMINI_API_KEY) {
    const model = process.env.ENTRY_AI_MODEL ?? 'gemini-2.0-flash';
    return { name: 'gemini', apiKey: process.env.GEMINI_API_KEY, model, label: `Gemini (${model})` };
  }

  if (requested === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    const model = process.env.ENTRY_AI_MODEL ?? 'claude-opus-5';
    return { name: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, model, label: `Claude (${model})` };
  }

  return { name: 'off', model: '', label: 'offline parser' };
}

function hostLabel(baseUrl: string, model: string): string {
  try {
    return `${new URL(baseUrl).hostname} (${model})`;
  } catch {
    return model;
  }
}

/** What every provider is asked to return. Kept deliberately small. */
export type ProviderDraft = {
  amount?: string | null;
  method?: string | null;
  category?: string | null;
  remarks?: string | null;
};

const SCHEMA_HINT = [
  'Return ONLY a JSON object, no prose and no code fence, with exactly these keys:',
  '{"amount": string|null, "method": string|null, "category": string|null, "remarks": string}',
  '',
  `"method" must be exactly one of: ${ALL_METHODS.join(', ')}`,
  `"category" must be exactly one of: ${ALL_CATEGORIES.join(', ')}`,
  '"amount" is digits only, e.g. "480" or "1234.50".',
  '',
  'Rules:',
  '- Use null for anything the text does not state. Never guess.',
  '- "method" is where the money came FROM. "on Coral" means the Coral card.',
  '- A CARD NAME as "category" means paying that card\'s bill: "paid 5000 to ICICI from Fi"',
  '  is method "Fi", category "ICICI".',
  '- "remarks" is a short description with the amount and method removed.',
  '- Indian amounts: "four eighty" is 480, "twelve hundred" is 1200.',
].join('\n');

/** Pull the first JSON object out of a reply, tolerating fences and chatter. */
export function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const TIMEOUT_MS = 12_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  // A model that is thinking about it is no use while standing at a till, and
  // the local parse is already on screen — so this gives up quickly.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the configured provider to read a transcript.
 * Returns null whenever there is no provider or it fails — the caller keeps
 * whatever the local parser produced rather than losing the entry.
 */
export async function askProvider(transcript: string): Promise<ProviderDraft | null> {
  const cfg = providerConfig();
  if (cfg.name === 'off') return null;

  const prompt = `${SCHEMA_HINT}\n\nText: "${transcript}"`;

  try {
    if (cfg.name === 'openai-compatible') {
      const json = await postJson(
        `${cfg.baseUrl}/chat/completions`,
        cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
        {
          model: cfg.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        },
      );
      const choices = json['choices'] as { message?: { content?: string } }[] | undefined;
      const content = choices?.[0]?.message?.content ?? '';
      return extractJson(content);
    }

    if (cfg.name === 'gemini') {
      const json = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`,
        {},
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        },
      );
      const candidates = json['candidates'] as
        | { content?: { parts?: { text?: string }[] } }[]
        | undefined;
      const content = candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return extractJson(content);
    }

    if (cfg.name === 'anthropic') {
      const json = await postJson(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': cfg.apiKey ?? '', 'anthropic-version': '2023-06-01' },
        {
          model: cfg.model,
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        },
      );
      const content = json['content'] as { type?: string; text?: string }[] | undefined;
      const text = content?.find((b) => b.type === 'text')?.text ?? '';
      return extractJson(text);
    }
  } catch (err) {
    // Never fail the entry over this. The local parse already stands.
    console.error('[entry-ai]', cfg.name, err instanceof Error ? err.message : err);
  }
  return null;
}
