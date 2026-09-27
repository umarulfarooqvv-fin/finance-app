import assert from 'node:assert/strict';
import { test } from 'vitest';
import { transcribeToEnglish, voiceConfig } from '@/lib/ai/transcribe';
import { summarise } from '@/lib/voice-drafts';

/* ===========================================================================
   Voice notes from the iPhone: audio in, English out, a draft to confirm.

   The provider cannot be tested, but what is sent can: the endpoint that
   TRANSLATES (so Malayalam arrives as English), a file name whose extension
   matches the audio (the provider picks the decoder from it), and the hint
   that stops "Fi" coming back as "fee".
   =========================================================================== */

const GROQ = {
  IMPORT_AI: 'openai-compatible',
  IMPORT_AI_BASE_URL: 'https://api.groq.com/openai/v1',
  IMPORT_AI_KEY: 'k',
  IMPORT_AI_MODEL: 'vision-model',
  VOICE_AI: undefined, VOICE_AI_BASE_URL: undefined, VOICE_AI_KEY: undefined, VOICE_AI_MODEL: undefined,
};

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const had: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    had[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { await fn(); } finally {
    for (const [k, v] of Object.entries(had)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

function stub(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; form: FormData; auth: string | undefined }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      form: init?.body as FormData,
      auth: (init?.headers as Record<string, string> | undefined)?.['authorization'],
    });
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const AUDIO = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32]).buffer;

test('voice notes use the photo provider by default, with Whisper', async () => {
  await withEnv(GROQ, async () => {
    const cfg = voiceConfig();
    assert.equal(cfg?.baseUrl, 'https://api.groq.com/openai/v1');
    assert.equal(cfg?.model, 'whisper-large-v3');
  });
  await withEnv({ ...GROQ, IMPORT_AI: 'off' }, async () => assert.equal(voiceConfig(), null, 'nothing to use'));
  await withEnv({ ...GROQ, VOICE_AI: 'off' }, async () => assert.equal(voiceConfig(), null, 'switched off'));
});

test('a recording is sent to be TRANSLATED, named for its format, with the hint', async () => {
  await withEnv(GROQ, async () => {
    const s = stub(200, { text: ' Four hundred and eighty rupees for tea from Fi. ' });
    try {
      const r = await transcribeToEnglish(AUDIO, 'audio/x-m4a');
      assert.deepEqual(r, { ok: true, text: 'Four hundred and eighty rupees for tea from Fi.' });
      const call = s.calls[0]!;
      assert.equal(call.url, 'https://api.groq.com/openai/v1/audio/translations', 'so Malayalam arrives as English');
      assert.equal(call.auth, 'Bearer k');
      assert.equal(call.form.get('model'), 'whisper-large-v3');
      assert.equal((call.form.get('file') as File).name, 'voice.m4a');
      assert.match(String(call.form.get('prompt')), /Scapia/, 'the card names, so "Fi" is not heard as "fee"');
    } finally { s.restore(); }
  });
});

test('a limit is said in words, not as a status code', async () => {
  await withEnv(GROQ, async () => {
    const s = stub(429, { error: { message: 'Rate limit reached on audio seconds per day (ASD). Please try again in 3m2s.' } });
    try {
      const r = await transcribeToEnglish(AUDIO, 'audio/mp4');
      assert.equal(r.ok, false);
      assert.match(r.ok === false ? r.error : '', /AI limit reached/);
    } finally { s.restore(); }
  });
});

test('silence is an error, not an empty draft', async () => {
  await withEnv(GROQ, async () => {
    const s = stub(200, { text: '  ' });
    try { assert.equal((await transcribeToEnglish(AUDIO, 'audio/mp4')).ok, false); } finally { s.restore(); }
  });
});

test('the summary names what is missing rather than hiding it', () => {
  assert.equal(summarise({ amount: '480', method: 'Fi', category: 'Food', remarks: 'tea' }), '₹480 · Food · Fi — tea');
  assert.equal(summarise({ amount: null, method: null, category: 'Food', remarks: '' }), 'amount? · Food · paid from?');
});
