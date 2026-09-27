import 'server-only';
import { ALL_CATEGORIES, ALL_METHODS } from '@/lib/types';
import { visionConfig } from '@/lib/ai/vision';
import { describeUsage, usageFromReply } from '@/lib/ai/usage';
import { nowIST } from '@/lib/time';

/* ===========================================================================
   A voice note, in English or Malayalam, turned into English text.

   iPhone dictation has no Malayalam, so a voice note is sent as AUDIO and
   read here by Whisper through the provider's `/audio/translations` endpoint,
   which TRANSLATES whatever it hears into English. One pipeline, one parser:
   the English text goes through the same spoken-entry reader as a phrase
   typed or dictated in English, and lands as a draft to confirm.

   The audio is used for this one request and not stored anywhere — not in
   the bucket, not in the log. It does leave the phone, for the provider to
   hear; that is the price of Malayalam, and the setting says so.

   A HINT GOES WITH EVERY RECORDING. Whisper accepts a short prompt of words
   it should expect, and without it "Fi" comes back as "fee". It does NOT fix
   numbers: "two hundred and fifty for petrol" was heard as 254 in testing,
   the "fifty for" / "fifty-four" confusion. That is why the result is shown
   to a person as a draft, with what was heard beside what was read.

   Configuration, by default the same provider as photo reading:
     VOICE_AI_BASE_URL / VOICE_AI_KEY   fall back to IMPORT_AI's
     VOICE_AI_MODEL                     default whisper-large-v3
   =========================================================================== */

export type VoiceConfig = { baseUrl: string; apiKey: string; model: string; label: string } | null;

export function voiceConfig(): VoiceConfig {
  const vision = visionConfig();
  const fromVision = vision.name === 'openai-compatible' ? vision : null;
  const baseUrl = (process.env.VOICE_AI_BASE_URL || fromVision?.baseUrl || '').replace(/\/$/, '');
  const apiKey = process.env.VOICE_AI_KEY || fromVision?.apiKey || '';
  const model = process.env.VOICE_AI_MODEL || 'whisper-large-v3';
  if (!baseUrl || (process.env.VOICE_AI === 'off')) return null;
  let host = baseUrl;
  try { host = new URL(baseUrl).hostname; } catch { /* keep as given */ }
  return { baseUrl, apiKey, model, label: `${host} (${model})` };
}

export function voiceConfigured(): boolean {
  return voiceConfig() !== null;
}

const HINT =
  "A spoken expense in Indian English or Malayalam, such as 'Four hundred and eighty rupees for tea from Fi'. "
  + `Payment methods: ${ALL_METHODS.join(', ')}. Categories: ${ALL_CATEGORIES.join(', ')}.`;

/** What an iPhone voice memo or Shortcut recording can be sent as. */
export const AUDIO_TYPES = [
  'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/mpeg', 'audio/mp3',
  'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/flac',
] as const;

const EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/flac': 'flac',
};

/** Groq's limit is 25MB; a spoken expense is a few hundred KB. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export type TranscribeResult = { ok: true; text: string } | { ok: false; error: string };

export async function transcribeToEnglish(bytes: ArrayBuffer, mime: string): Promise<TranscribeResult> {
  const cfg = voiceConfig();
  if (!cfg) return { ok: false, error: 'Voice notes are not set up. See VOICE_AI in .env.example.' };

  const type = (mime.split(';')[0] ?? '').trim().toLowerCase() || 'audio/mp4';
  const form = new FormData();
  // The provider decides the format from the file NAME, so it must match.
  form.set('file', new Blob([bytes], { type }), `voice.${EXTENSIONS[type] ?? 'm4a'}`);
  form.set('model', cfg.model);
  form.set('response_format', 'json');
  form.set('temperature', '0');
  form.set('prompt', HINT);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40_000);
  try {
    const res = await fetch(`${cfg.baseUrl}/audio/translations`, {
      method: 'POST',
      headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
      body: form,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) {
        const usage = usageFromReply(cfg.label, nowIST(), 429, res.headers, body);
        return { ok: false, error: describeUsage(usage, usage.at)?.text ?? 'The voice limit was reached.' };
      }
      return { ok: false, error: `Could not hear that: ${res.status} ${body.slice(0, 160)}` };
    }
    const json = (await res.json()) as { text?: string };
    const text = (json.text ?? '').trim();
    return text ? { ok: true, text } : { ok: false, error: 'Nothing could be heard in that recording.' };
  } catch (err) {
    return { ok: false, error: `Could not reach the voice service: ${err instanceof Error ? err.message : err}` };
  } finally {
    clearTimeout(timer);
  }
}
