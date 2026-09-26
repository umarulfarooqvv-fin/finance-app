import { after, NextResponse } from 'next/server';
import { insertCapture } from '@/lib/captures';
import { readCaptureIntoDraft } from '@/lib/capture-drafts';
import {
  deleteObject, extensionFor, idFromBytes, isAllowedImage, MAX_IMAGE_BYTES, putObject,
  sniffImage, storageConfigured,
} from '@/lib/storage';
import { isValidInstant } from '@/lib/validation';
import { nowIST } from '@/lib/time';
import { toStorable } from '@/lib/image-convert';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* ===========================================================================
   Photo ingestion for the iPhone Shortcut.

   Deliberately forgiving about HOW the image arrives, because a Shortcut is
   fiddly to build and every extra step is one more thing to get wrong:

     - the raw photo as the request body, with Content-Type: image/jpeg
       (Shortcuts: "Get Contents of URL", Request Body = File)
     - multipart/form-data with the image in any field
     - JSON with a base64 string

   AND THE BYTES DECIDE, not the header. Shortcuts picks the Content-Type for
   you and gets it wrong in ways you cannot see from a phone: left on its
   default Request Body of JSON it posts the photo itself as
   `application/json`, which used to come back as "Could not read the JSON
   body" — a true sentence that tells you nothing about which of a dozen
   toggles to change. If the body looks like an image, it is treated as one.

   Guarded by INGEST_TOKEN in the x-token header, exactly like /api/entry, and
   exempt from the PIN lock for the same reason.

   THE ID IS DERIVED FROM THE BYTES. A Shortcut that retries on a bad
   connection re-sends the same photo, and a random id would leave the inbox
   holding three pictures of one receipt. The same image posted twice is one
   capture.
   =========================================================================== */

function unauthorised() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
}

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

type Incoming = { bytes: ArrayBuffer; mime: string; note: string; ts: string };

/** Parse bytes already read off the wire, rather than consuming the stream. */
function parseJson(bytes: ArrayBuffer): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function read(req: Request): Promise<Incoming | { error: string }> {
  const type = (req.headers.get('content-type') ?? '').toLowerCase();
  const url = new URL(req.url);
  // A note and a timestamp can ride along in the query string when the body is
  // the raw photo and there is nowhere else to put them.
  const qsNote = url.searchParams.get('note') ?? '';
  const qsTs = url.searchParams.get('ts') ?? '';

  if (type.startsWith('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    if (!form) return { error: 'Could not read the form data.' };

    let file: File | null = null;
    for (const value of form.values()) {
      if (value instanceof File && value.size > 0) { file = value; break; }
    }
    if (!file) return { error: 'No image was attached.' };

    return {
      bytes: await file.arrayBuffer(),
      mime: (file.type || 'image/jpeg').toLowerCase(),
      note: String(form.get('note') ?? qsNote ?? ''),
      ts: String(form.get('ts') ?? qsTs ?? ''),
    };
  }

  /* Everything else reads the body ONCE, up front: a request body can only be
     consumed a single time, so deciding "is this JSON or is it a photo?" has
     to happen on bytes already in hand rather than by trying req.json() and
     reaching for the stream again when it fails. */
  const body = await req.arrayBuffer();
  if (body.byteLength === 0) {
    return { error: 'The request body was empty. In the Shortcut, set Request Body to File and pick the photo.' };
  }

  if (type.startsWith('application/json')) {
    const json = parseJson(body);
    if (!json) {
      // Not JSON at all. Overwhelmingly this is the photo itself under a JSON
      // content type, so take it rather than refusing over a header.
      const sniffed = sniffImage(body);
      if (sniffed) return { bytes: body, mime: sniffed, note: qsNote, ts: qsTs };
      return {
        error: 'The body was sent as JSON but is not JSON, and is not an image either. '
          + 'In the Shortcut, set Request Body to File and pick the photo.',
      };
    }
    const raw = typeof json['image'] === 'string' ? json['image'] : '';
    if (!raw) return { error: 'No image was attached. Send it as "image", base64-encoded.' };

    // A data: URL carries its own type; a bare base64 string does not.
    const match = raw.match(/^data:([\w/+.-]+);base64,(.*)$/s);
    const b64 = (match ? match[2] : raw) ?? '';
    const mime = (match?.[1] ?? String(json['mime'] ?? 'image/jpeg')).toLowerCase();

    let buf: Buffer;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      return { error: 'The image was not valid base64.' };
    }
    if (buf.byteLength === 0) return { error: 'The image was empty.' };

    return {
      bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      mime,
      note: String(json['note'] ?? qsNote ?? ''),
      ts: String(json['ts'] ?? qsTs ?? ''),
    };
  }

  // The simplest path, and the one the Shortcut should use: the photo itself.
  // The sniffed type wins over the declared one — an octet-stream that is
  // plainly a JPEG is a JPEG.
  const declared = type.split(';')[0]?.trim() || 'image/jpeg';
  return { bytes: body, mime: sniffImage(body) ?? declared, note: qsNote, ts: qsTs };
}

export async function POST(req: Request): Promise<Response> {
  try {
    const expected = process.env.INGEST_TOKEN;
    const provided = req.headers.get('x-token') ?? new URL(req.url).searchParams.get('token');
    if (expected && provided !== expected) return unauthorised();

    if (!storageConfigured()) return bad('Storage is not configured on the server.', 500);

    const incoming = await read(req);
    if ('error' in incoming) return bad(incoming.error);

    const { bytes, note } = incoming;
    /* Normalised in ONE place. A content type may carry parameters
       ("image/jpeg; charset=binary"), and only the raw-body branch used to
       strip them — so the same photo was accepted or refused depending on how
       the Shortcut happened to send it. */
    const mime = incoming.mime.split(';')[0]?.trim().toLowerCase() ?? '';

    if (!isAllowedImage(mime)) {
      return bad(`${mime} is not an image this app accepts.`);
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return bad(`That image is ${Math.round(bytes.byteLength / 1024 / 1024)}MB; the limit is 20MB.`);
    }

    /* The phone's own clock decides WHEN the photo was taken, because that is
       the one thing the server cannot know and the whole point of the capture.
       Anything malformed falls back to the server clock rather than being
       stored as a date that breaks every list it appears in. */
    const ts = isValidInstant(incoming.ts) ? incoming.ts : nowIST();

    // The id comes from the bytes AS SENT, so a Shortcut retrying the same
    // HEIC still lands on the same capture after it has been converted.
    const id = await idFromBytes(bytes);
    const stored = await toStorable(bytes, mime);
    const path = `${ts.slice(0, 7)}/${id}.${extensionFor(stored.mime)}`;

    await putObject(path, stored.bytes, stored.mime);

    /* The object is written first, so the row never points at nothing. If the
       row then fails — the table missing, the database unreachable — the image
       is removed again, because an object with no row is invisible: nothing
       lists it, nothing can action it, and it sits in the bucket for ever. */
    try {
      await insertCapture({
        id,
        ts,
        path,
        mime: stored.mime,
        bytes: stored.bytes.byteLength,
        note: note.trim().slice(0, 500),
        status: 'pending',
        transaction_id: null,
        source: 'shortcut',
      });
    } catch (err) {
      await deleteObject(path);
      throw err;
    }

    /* Read it into rows WITHOUT being asked, after the phone has its reply.
       The Shortcut is one tap at a till and must not wait on a model; `after`
       runs once the response is out, so by the time the inbox is opened the
       rows are already there to confirm. A failure is recorded on the draft
       and shown in the inbox — it never affects this response, because the
       photo itself is safely stored either way. */
    after(async () => {
      try {
        await readCaptureIntoDraft(id);
      } catch (err) {
        console.error('[capture-draft]', id, err instanceof Error ? err.message : err);
      }
    });

    return NextResponse.json({ ok: true, id, ts, bytes: bytes.byteLength });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
