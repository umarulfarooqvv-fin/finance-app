import { NextResponse } from 'next/server';
import { insertCapture } from '@/lib/captures';
import {
  deleteObject, extensionFor, idFromBytes, isAllowedImage, MAX_IMAGE_BYTES, putObject, storageConfigured,
} from '@/lib/storage';
import { isValidInstant } from '@/lib/validation';
import { nowIST } from '@/lib/time';

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

  if (type.startsWith('application/json')) {
    const json = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json) return { error: 'Could not read the JSON body.' };
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
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength === 0) return { error: 'The request body was empty.' };
  return { bytes, mime: type.split(';')[0]?.trim() || 'image/jpeg', note: qsNote, ts: qsTs };
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

    const id = await idFromBytes(bytes);
    const path = `${ts.slice(0, 7)}/${id}.${extensionFor(mime)}`;

    await putObject(path, bytes, mime);

    /* The object is written first, so the row never points at nothing. If the
       row then fails — the table missing, the database unreachable — the image
       is removed again, because an object with no row is invisible: nothing
       lists it, nothing can action it, and it sits in the bucket for ever. */
    try {
      await insertCapture({
        id,
        ts,
        path,
        mime,
        bytes: bytes.byteLength,
        note: note.trim().slice(0, 500),
        status: 'pending',
        transaction_id: null,
        source: 'shortcut',
      });
    } catch (err) {
      await deleteObject(path);
      throw err;
    }

    return NextResponse.json({ ok: true, id, ts, bytes: bytes.byteLength });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
