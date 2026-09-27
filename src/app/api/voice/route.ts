import { NextResponse } from 'next/server';
import { parseSpokenEntry } from '@/lib/ai/parse-entry';
import { AUDIO_TYPES, MAX_AUDIO_BYTES, transcribeToEnglish } from '@/lib/ai/transcribe';
import { saveVoiceDraft, summarise, type VoiceDraft } from '@/lib/voice-drafts';
import { nowIST } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* ===========================================================================
   A spoken expense from the iPhone, in English or Malayalam.

   Two Shortcuts post here, both guarded by INGEST_TOKEN in the x-token header
   exactly like /api/entry:

     - a RECORDING (Record Audio → body is the file) — any language Whisper
       understands, Malayalam included, translated to English on the way in
     - DICTATED TEXT (Dictate Text → JSON {"text": "..."}) — English, heard on
       the phone by the iPhone itself, so no audio leaves it

   Either way the words go through the same spoken-entry reader the app's own
   Speak button uses, and the result waits in the Inbox as a DRAFT. Nothing is
   saved as an entry here: a misheard amount must meet a person before it
   meets the ledger.

   The reply says what was understood — "Ready in Inbox: ₹480 · Food · Fi —
   tea" — so the Shortcut can show it straight away and a mishearing is
   caught while the payment is still in mind. `?format=text` returns just that
   sentence, which is what the Shortcut's Show Notification wants.

   Idempotent: the draft id comes from the recording or the text, so a
   Shortcut retrying over a bad connection lands on the same draft.
   =========================================================================== */

function reply(req: Request, status: number, body: { ok: boolean; message: string } & Record<string, unknown>) {
  if (new URL(req.url).searchParams.get('format') === 'text') {
    return new NextResponse(body.message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return NextResponse.json(body, { status });
}

const bad = (req: Request, message: string, status = 400) => reply(req, status, { ok: false, message, error: message });

async function hashId(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `voice-${[...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** An M4A/MP4 recording, whatever the header claims — Shortcuts mislabels. */
const looksLikeM4a = (b: ArrayBuffer) =>
  b.byteLength > 12 && String.fromCharCode(...new Uint8Array(b.slice(4, 8))) === 'ftyp';

type Incoming = { kind: 'audio'; bytes: ArrayBuffer; mime: string } | { kind: 'text'; text: string };

async function read(req: Request): Promise<Incoming | { error: string }> {
  const type = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();

  if (type === 'multipart/form-data') {
    const form = await req.formData().catch(() => null);
    if (!form) return { error: 'Could not read the form.' };
    const text = form.get('text');
    if (typeof text === 'string' && text.trim()) return { kind: 'text', text };
    for (const v of form.values()) {
      if (v instanceof File && v.size > 0) {
        return { kind: 'audio', bytes: await v.arrayBuffer(), mime: v.type || 'audio/mp4' };
      }
    }
    return { error: 'Send a recording as the file, or the words as "text".' };
  }

  // Everything else: read once, then decide what it is.
  const body = await req.arrayBuffer();
  if (body.byteLength === 0) return { error: 'Nothing was sent. In the Shortcut, set Request Body to File and pick the recording.' };

  if ((AUDIO_TYPES as readonly string[]).includes(type) || looksLikeM4a(body)) {
    return { kind: 'audio', bytes: body, mime: (AUDIO_TYPES as readonly string[]).includes(type) ? type : 'audio/mp4' };
  }

  const raw = new TextDecoder().decode(body).trim();
  if (type === 'application/json' || raw.startsWith('{')) {
    try {
      const json = JSON.parse(raw) as { text?: unknown };
      if (typeof json.text === 'string' && json.text.trim()) return { kind: 'text', text: json.text };
    } catch { /* not JSON after all — treat as plain words below */ }
    if (raw.startsWith('{')) return { error: 'Send the words as {"text": "..."}.' };
  }
  return { kind: 'text', text: raw };
}

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.INGEST_TOKEN;
  const provided = req.headers.get('x-token') ?? new URL(req.url).searchParams.get('token');
  if (expected && provided !== expected) return bad(req, 'Unauthorized', 401);

  const incoming = await read(req);
  if ('error' in incoming) return bad(req, incoming.error);

  let heard: string;
  let id: string;
  if (incoming.kind === 'audio') {
    if (incoming.bytes.byteLength > MAX_AUDIO_BYTES) return bad(req, 'That recording is too long for one entry.');
    const result = await transcribeToEnglish(incoming.bytes, incoming.mime);
    if (!result.ok) return bad(req, result.error, 502);
    heard = result.text;
    id = await hashId(incoming.bytes);
  } else {
    heard = incoming.text.trim();
    id = await hashId(new TextEncoder().encode(`${nowIST().slice(0, 13)}|${heard}`).buffer as ArrayBuffer);
  }

  const parsed = await parseSpokenEntry(heard);
  if (!parsed.ok) return bad(req, parsed.error);

  const draft: VoiceDraft = {
    id,
    ts: nowIST(),
    via: incoming.kind === 'audio' ? 'audio' : 'dictation',
    heard,
    amount: parsed.draft.amount,
    method: parsed.draft.method,
    category: parsed.draft.category,
    remarks: parsed.draft.remarks,
    uncertain: parsed.draft.uncertain,
  };
  await saveVoiceDraft(draft);

  const summary = summarise(draft);
  return reply(req, 200, {
    ok: true,
    id,
    heard,
    summary,
    draft: { amount: draft.amount, method: draft.method, category: draft.category, remarks: draft.remarks },
    message: `Ready in Inbox: ${summary}\nHeard: "${heard}"`,
  });
}
