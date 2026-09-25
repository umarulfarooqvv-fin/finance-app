import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readReceipts, visionConfig, visionConfigured } from '@/lib/ai/vision';

/* ===========================================================================
   Reading a photo into import rows.

   The provider itself cannot be tested — that is somebody's server — but the
   shape of what we send it and what we make of the reply can, and those are
   exactly what silently breaks: an image part in the wrong key returns "I
   cannot see an image" with a 200, and a reply read from the wrong field
   returns empty rows. Both look like "the AI did not work" and neither
   surfaces an error.

   The rows are the same pipe-delimited text a person would paste, and nothing
   here writes. See src/lib/ai/vision.ts.
   =========================================================================== */

const ROWS = '14/09/2026 | 450.00 | Fi | Food | Hospital canteen';
const IMAGE = { bytes: new Uint8Array([1, 2, 3]).buffer, mime: 'image/jpeg' };

/** Run `fn` with these env vars, restoring whatever was there. */
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const had: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    had[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(had)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/* What a provider was sent. The body is deliberately loose: the point of
   these assertions is the wire shape each provider expects, which is only
   ever JSON, so they read it the way the provider's own parser would. */
type SentCall = {
  url: string;
  headers: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
};

/** Capture the one request the reader makes, and answer it with `reply`. */
function stubFetch(reply: unknown, ok = true) {
  const calls: SentCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as SentCall['body'],
    });
    return {
      ok,
      status: ok ? 200 : 429,
      json: async () => reply,
      text: async () => JSON.stringify(reply),
    };
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Answer each call in turn, so a retry can be given a different reply. */
function stubSequence(replies: { status: number; body: unknown }[]) {
  const calls: SentCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const reply = replies[Math.min(calls.length, replies.length - 1)]!;
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as SentCall['body'],
    });
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body),
    };
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const GROQ = {
  IMPORT_AI: 'openai-compatible',
  IMPORT_AI_BASE_URL: 'https://api.groq.com/openai/v1',
  IMPORT_AI_KEY: 'k',
  IMPORT_AI_MODEL: 'vision-model',
  // The retry's wait is real time; these tests assert that it retries, not
  // that it sleeps.
  IMPORT_AI_RETRY_PAUSE_MS: '0',
};

const okReply = { status: 200, body: { choices: [{ message: { content: ROWS } }] } };

test('with no provider set, nothing is read and the reason says so', async () => {
  await withEnv({ IMPORT_AI: 'off' }, async () => {
    assert.equal(visionConfigured(), false);
    const result = await readReceipts([IMAGE]);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : '', /IMPORT_AI/);
  });
});

test('an openai-compatible provider needs both a base url and a model', async () => {
  await withEnv(
    { IMPORT_AI: 'openai-compatible', IMPORT_AI_BASE_URL: 'https://x/v1', IMPORT_AI_MODEL: undefined },
    async () => assert.equal(visionConfig().name, 'off', 'no model means not configured'),
  );
  await withEnv(
    { IMPORT_AI: 'openai-compatible', IMPORT_AI_BASE_URL: undefined, IMPORT_AI_MODEL: 'm' },
    async () => assert.equal(visionConfig().name, 'off', 'no base url means not configured'),
  );
});

test('an openai-compatible provider is sent the image as a data url, and its reply is read', async () => {
  await withEnv(
    {
      IMPORT_AI: 'openai-compatible',
      IMPORT_AI_BASE_URL: 'https://api.groq.com/openai/v1',
      IMPORT_AI_KEY: 'k',
      IMPORT_AI_MODEL: 'vision-model',
    },
    async () => {
      const stub = stubFetch({ choices: [{ message: { content: `${ROWS}\n` } }] });
      try {
        const result = await readReceipts([IMAGE]);
        assert.equal(result.ok, true);
        assert.equal(result.ok === true ? result.text : '', ROWS, 'trimmed, and read from the right field');

        const [call] = stub.calls;
        assert.equal(call!.url, 'https://api.groq.com/openai/v1/chat/completions');
        assert.equal(call!.headers['authorization'], 'Bearer k');

        const parts = call!.body.messages[0].content;
        assert.equal(parts[0].type, 'text', 'the instruction comes first');
        assert.match(parts[0].text, /DD\/MM\/YYYY HH:MM \| amount \| method \| category \| description/);
        assert.equal(parts[1].type, 'image_url');
        assert.match(parts[1].image_url.url, /^data:image\/jpeg;base64,/);
      } finally {
        stub.restore();
      }
    },
  );
});

test('a local provider with no key is sent no authorization header', async () => {
  await withEnv(
    {
      IMPORT_AI: 'openai-compatible',
      IMPORT_AI_BASE_URL: 'http://localhost:11434/v1',
      IMPORT_AI_KEY: '',
      IMPORT_AI_MODEL: 'llava',
    },
    async () => {
      const stub = stubFetch({ choices: [{ message: { content: ROWS } }] });
      try {
        await readReceipts([IMAGE]);
        assert.equal(stub.calls[0]!.headers['authorization'], undefined, 'Ollama needs no key');
      } finally {
        stub.restore();
      }
    },
  );
});

test('gemini gets inline_data parts and is read from candidates', async () => {
  await withEnv(
    { IMPORT_AI: 'gemini', GEMINI_API_KEY: 'gk', IMPORT_AI_MODEL: undefined },
    async () => {
      const stub = stubFetch({ candidates: [{ content: { parts: [{ text: ROWS }] } }] });
      try {
        const result = await readReceipts([IMAGE, IMAGE]);
        assert.equal(result.ok === true ? result.text : '', ROWS);

        const call = stub.calls[0]!;
        assert.match(call.url, /gemini-2\.0-flash:generateContent/, 'a vision-capable default');
        const parts = call.body.contents[0].parts;
        assert.equal(parts.length, 3, 'the instruction plus both photos');
        assert.equal(parts[1].inline_data.mime_type, 'image/jpeg');
        assert.ok(parts[1].inline_data.data.length > 0);
      } finally {
        stub.restore();
      }
    },
  );
});

test('anthropic gets base64 image blocks and is read from the text block', async () => {
  await withEnv(
    { IMPORT_AI: 'anthropic', ANTHROPIC_API_KEY: 'ak', IMPORT_AI_MODEL: undefined },
    async () => {
      const stub = stubFetch({ content: [{ type: 'thinking' }, { type: 'text', text: ROWS }] });
      try {
        const result = await readReceipts([IMAGE]);
        assert.equal(result.ok === true ? result.text : '', ROWS, 'the text block, not the first block');

        const call = stub.calls[0]!;
        assert.equal(call.headers['x-api-key'], 'ak');
        assert.equal(call.headers['anthropic-version'], '2023-06-01');
        const blocks = call.body.messages[0].content;
        assert.equal(blocks[1].type, 'image');
        assert.equal(blocks[1].source.media_type, 'image/jpeg');
      } finally {
        stub.restore();
      }
    },
  );
});

test('a refused request is reported, not swallowed into empty rows', async () => {
  await withEnv(
    {
      IMPORT_AI: 'openai-compatible',
      IMPORT_AI_BASE_URL: 'https://x/v1',
      IMPORT_AI_KEY: 'k',
      IMPORT_AI_MODEL: 'm',
      IMPORT_AI_RETRY_PAUSE_MS: '0',
    },
    async () => {
      const stub = stubFetch({ error: 'rate limited' }, false);
      try {
        const result = await readReceipts([IMAGE]);
        assert.equal(result.ok, false, 'a 429 must not look like a photo with no payments in it');
        assert.match(result.ok === false ? result.error : '', /429/);
      } finally {
        stub.restore();
      }
    },
  );
});

test('a reply with nothing in it is an error rather than silent empty rows', async () => {
  await withEnv(
    {
      IMPORT_AI: 'openai-compatible',
      IMPORT_AI_BASE_URL: 'https://x/v1',
      IMPORT_AI_KEY: 'k',
      IMPORT_AI_MODEL: 'm',
    },
    async () => {
      const stub = stubFetch({ choices: [{ message: { content: '   ' } }] });
      try {
        const result = await readReceipts([IMAGE]);
        assert.equal(result.ok, false);
      } finally {
        stub.restore();
      }
    },
  );
});

test('more photos than one batch allows is refused before any call is made', async () => {
  await withEnv(
    {
      IMPORT_AI: 'openai-compatible',
      IMPORT_AI_BASE_URL: 'https://x/v1',
      IMPORT_AI_KEY: 'k',
      IMPORT_AI_MODEL: 'm',
    },
    async () => {
      const stub = stubFetch({ choices: [{ message: { content: ROWS } }] });
      try {
        const result = await readReceipts(Array.from({ length: 13 }, () => IMAGE));
        assert.equal(result.ok, false);
        assert.equal(stub.calls.length, 0, 'refused without spending a call');
      } finally {
        stub.restore();
      }
    },
  );
});

/* ---------------------------------------------------------------------------
   Trying again when the provider is merely busy.

   A free tier answers 503 "model overloaded" often enough to matter, and the
   read that matters most happens when a photo ARRIVES, with nobody watching.
   A blip there leaves the photo unread until somebody notices, which is the
   chore this feature exists to remove.
   --------------------------------------------------------------------------- */

test('a 503 is tried again, and the second answer is used', async () => {
  await withEnv(GROQ, async () => {
    const stub = stubSequence([{ status: 503, body: { error: 'model overloaded' } }, okReply]);
    try {
      const result = await readReceipts([IMAGE]);
      assert.equal(result.ok, true, 'the retry succeeded');
      assert.equal(result.ok === true ? result.text : '', ROWS);
      assert.equal(stub.calls.length, 2, 'asked twice');
    } finally {
      stub.restore();
    }
  });
});

test('a rate limit is tried again too', async () => {
  await withEnv(GROQ, async () => {
    const stub = stubSequence([{ status: 429, body: { error: 'slow down' } }, okReply]);
    try {
      assert.equal((await readReceipts([IMAGE])).ok, true);
      assert.equal(stub.calls.length, 2);
    } finally {
      stub.restore();
    }
  });
});

test('a refusal is NOT tried again — asking twice cannot change the answer', async () => {
  await withEnv(GROQ, async () => {
    // A bad key, a model that does not exist, an image it will not take.
    const stub = stubSequence([{ status: 401, body: { error: 'invalid api key' } }]);
    try {
      const result = await readReceipts([IMAGE]);
      assert.equal(result.ok, false);
      assert.equal(stub.calls.length, 1, 'one attempt only');
    } finally {
      stub.restore();
    }
  });
});

test('a provider that is down throughout gives up and says so', async () => {
  await withEnv(GROQ, async () => {
    const stub = stubSequence([{ status: 503, body: { error: 'model overloaded' } }]);
    try {
      const result = await readReceipts([IMAGE]);
      assert.equal(result.ok, false, 'not a silent empty reading');
      assert.match(result.ok === false ? result.error : '', /503/);
      assert.equal(stub.calls.length, 3, 'tried the allowed number of times, then stopped');
    } finally {
      stub.restore();
    }
  });
});

test('a HEIC photo is refused before any call, with the fix in the message', async () => {
  await withEnv(GROQ, async () => {
    const stub = stubFetch({ choices: [{ message: { content: ROWS } }] });
    try {
      const result = await readReceipts([{ bytes: IMAGE.bytes, mime: 'image/heic' }]);
      assert.equal(result.ok, false);
      assert.match(result.ok === false ? result.error : '', /Convert Image to JPEG/);
      assert.equal(stub.calls.length, 0, 'no request the provider would only reject');
    } finally {
      stub.restore();
    }
  });
});

test('the day a photo was taken is given, so a year-less date has an anchor', async () => {
  await withEnv(GROQ, async () => {
    const stub = stubFetch({ choices: [{ message: { content: ROWS } }] });
    try {
      await readReceipts([IMAGE], '2026-09-25');
      assert.match(stub.calls[0]!.body.messages[0].content[0].text, /taken on 25\/09\/2026/);
    } finally {
      stub.restore();
    }
  });
});
