import 'server-only';
import { IMPORT_PROMPT } from '@/lib/import-prompt';

/* ===========================================================================
   Reading a photo of a bill or a screenshot straight into paste-rows text.

   This is the SAME prompt the "copy the prompt" panel on /import already
   hands to an outside assistant by hand — the only difference is who sends
   it. Nothing here decides an entry: it returns text in the same pipe-
   delimited shape a person would paste, which lands in the same reviewable
   table and is not saved until Import is pressed.

   A SEPARATE provider from ENTRY_AI on purpose. Entry parsing is text-only,
   so most free chat models cover it; reading a photo needs a VISION-capable
   model, which is a different, shorter list — Groq's and OpenRouter's fast
   free text models are not the same ones that take an image. Mirrors
   ENTRY_AI's shape rather than sharing it, so a person can point each at a
   model that actually does the job:

     IMPORT_AI=off                      no conversion (the default)
     IMPORT_AI=openai-compatible        + IMPORT_AI_BASE_URL, IMPORT_AI_KEY, IMPORT_AI_MODEL
     IMPORT_AI=gemini                   + GEMINI_API_KEY [, IMPORT_AI_MODEL]
     IMPORT_AI=anthropic                + ANTHROPIC_API_KEY [, IMPORT_AI_MODEL]

   Known-free vision setups, for reference (check the provider's own model
   list before relying on a name here — free vision models change faster than
   free text ones):

     Groq        https://api.groq.com/openai/v1   a llama "vision" model
     OpenRouter  https://openrouter.ai/api/v1     any vision model id ending ":free"
     Gemini      (no base url needed)             gemini-2.0-flash
     Ollama      http://localhost:11434/v1        llava, moondream (no key, fully local)

   Anthropic is included for the same shape as ENTRY_AI, not because it is
   free — it is the one paid option here, and only useful if ANTHROPIC_API_KEY
   is already set for /ask.
   =========================================================================== */

export type VisionProviderName = 'off' | 'openai-compatible' | 'gemini' | 'anthropic';

export type VisionConfig = {
  name: VisionProviderName;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  /** Shown in the UI so the source of a conversion is never a mystery. */
  label: string;
};

export function visionConfig(): VisionConfig {
  const requested = (process.env.IMPORT_AI ?? '').trim().toLowerCase() as VisionProviderName;

  if (requested === 'openai-compatible') {
    const baseUrl = process.env.IMPORT_AI_BASE_URL?.replace(/\/$/, '');
    const model = process.env.IMPORT_AI_MODEL ?? '';
    // A local Ollama needs no key; a hosted provider does.
    const apiKey = process.env.IMPORT_AI_KEY ?? '';
    if (baseUrl && model) {
      return { name: 'openai-compatible', baseUrl, apiKey, model, label: hostLabel(baseUrl, model) };
    }
  }

  if (requested === 'gemini' && process.env.GEMINI_API_KEY) {
    const model = process.env.IMPORT_AI_MODEL ?? 'gemini-2.0-flash';
    return { name: 'gemini', apiKey: process.env.GEMINI_API_KEY, model, label: `Gemini (${model})` };
  }

  if (requested === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    const model = process.env.IMPORT_AI_MODEL ?? 'claude-opus-5';
    return { name: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, model, label: `Claude (${model})` };
  }

  return { name: 'off', model: '', label: 'not set up' };
}

export function visionConfigured(): boolean {
  return visionConfig().name !== 'off';
}

function hostLabel(baseUrl: string, model: string): string {
  try {
    return `${new URL(baseUrl).hostname} (${model})`;
  } catch {
    return model;
  }
}

export type VisionImage = { bytes: ArrayBuffer; mime: string };

export type VisionResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/* A photo takes longer to read than a sentence, but the budget is the route's
   own maxDuration of 60s and an attempt can be retried, so one attempt cannot
   have the whole of it: 25s twice plus the pause between them leaves room to
   answer. */
const TIMEOUT_MS = 25_000;
const ATTEMPTS = 3;

/* The whole budget is the route's own maxDuration of 60s, and attempts share
   it. A refusal comes back in well under a second, so three tries cost almost
   nothing in the case they are FOR; the budget only matters when a read is
   genuinely slow, and there it stops the retries rather than letting the
   platform kill the request mid-flight. */
const BUDGET_MS = 40_000;

/** How long to wait before trying again. Overridable so a test suite does not
    sit through it, and so a habitually slow provider can be given longer. */
const retryPauseMs = () => {
  const raw = Number(process.env.IMPORT_AI_RETRY_PAUSE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1_000;
};
const MAX_IMAGES = 12; // One screenshot conversation's worth, not a whole month.

/** Worth trying again: the provider is busy or briefly broken, not refusing. */
function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

async function attempt(url: string, headers: Record<string, string>, body: unknown) {
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
    if (!res.ok) {
      const error = new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
      return { ok: false as const, status: res.status, error };
    }
    return { ok: true as const, json: (await res.json()) as Record<string, unknown> };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Post, and try again if the provider was merely busy.
 *
 * A free tier answers "over capacity" often enough to matter — Groq's own 503
 * says "please try again and back off exponentially" — and the read that
 * matters most happens at ARRIVAL, with nobody watching. A blip there leaves
 * a photo sitting unread until somebody notices and presses Retry, which is
 * exactly the chore this feature exists to remove.
 *
 * A refusal is NOT retried — a bad key, a model that does not exist, an image
 * it will not take. Asking twice cannot change that answer, and hammering a
 * provider that has already said no is how a free tier stops being free.
 */
async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const started = Date.now();
  let last: Error = new Error('No attempt was made.');

  for (let i = 0; i < ATTEMPTS; i += 1) {
    const result = await attempt(url, headers, body);
    if (result.ok) return result.json;

    last = result.error;
    if (!isTransient(result.status) || i === ATTEMPTS - 1) break;

    const pause = retryPauseMs() * 2 ** i;
    if (Date.now() - started + pause > BUDGET_MS) break;
    await new Promise((resolve) => { setTimeout(resolve, pause); });
  }

  throw last;
}

const b64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64');

/**
 * Ask the configured provider to read these photos as paste-rows text.
 *
 * Several images in one call, not one call per image — a day at a hospital
 * is one occasion across several receipts, and the prompt already asks for
 * one description across lines that belong together, which only works if it
 * sees them at once.
 */
export async function readReceipts(
  images: VisionImage[],
  /** The day the photos were taken, as YYYY-MM-DD. A payment screen often
      prints "September 22" with no year, and a model left to supply one will
      invent it — observed: a 2026 payment read back as 2025. */
  takenOn?: string,
): Promise<VisionResult> {
  const cfg = visionConfig();
  if (cfg.name === 'off') {
    return { ok: false, error: 'Photo conversion is not set up. See IMPORT_AI in .env.example.' };
  }
  if (images.length === 0) return { ok: false, error: 'No photos to read.' };
  if (images.length > MAX_IMAGES) {
    return { ok: false, error: `Too many photos at once — send at most ${MAX_IMAGES}.` };
  }

  const prompt = takenOn && /^\d{4}-\d{2}-\d{2}$/.test(takenOn)
    ? `${IMPORT_PROMPT}\n\nThese were taken on ${takenOn.slice(8, 10)}/${takenOn.slice(5, 7)}/${takenOn.slice(0, 4)}. `
      + 'A date shown without a year is on or before that day.'
    : IMPORT_PROMPT;

  try {
    if (cfg.name === 'openai-compatible') {
      const json = await postJson(
        `${cfg.baseUrl}/chat/completions`,
        cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
        {
          model: cfg.model,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                ...images.map((img) => ({
                  type: 'image_url',
                  image_url: { url: `data:${img.mime};base64,${b64(img.bytes)}` },
                })),
              ],
            },
          ],
        },
      );
      const choices = json['choices'] as { message?: { content?: string } }[] | undefined;
      const text = (choices?.[0]?.message?.content ?? '').trim();
      return text ? { ok: true, text } : { ok: false, error: 'The model returned nothing readable.' };
    }

    if (cfg.name === 'gemini') {
      const json = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`,
        {},
        {
          contents: [
            {
              parts: [
                { text: prompt },
                ...images.map((img) => ({ inline_data: { mime_type: img.mime, data: b64(img.bytes) } })),
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        },
      );
      const candidates = json['candidates'] as
        | { content?: { parts?: { text?: string }[] } }[]
        | undefined;
      const text = (candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
      return text ? { ok: true, text } : { ok: false, error: 'The model returned nothing readable.' };
    }

    if (cfg.name === 'anthropic') {
      const json = await postJson(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': cfg.apiKey ?? '', 'anthropic-version': '2023-06-01' },
        {
          model: cfg.model,
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                ...images.map((img) => ({
                  type: 'image',
                  source: { type: 'base64', media_type: img.mime, data: b64(img.bytes) },
                })),
              ],
            },
          ],
        },
      );
      const content = json['content'] as { type?: string; text?: string }[] | undefined;
      const text = (content?.find((b) => b.type === 'text')?.text ?? '').trim();
      return text ? { ok: true, text } : { ok: false, error: 'The model returned nothing readable.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[import-ai]', cfg.name, message);
    return { ok: false, error: `Could not read those photos: ${message.slice(0, 200)}` };
  }

  return { ok: false, error: 'Photo conversion is not set up.' };
}
