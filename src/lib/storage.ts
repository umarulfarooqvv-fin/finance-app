import 'server-only';

/* ===========================================================================
   Supabase Storage over the REST API, with global fetch.

   No SDK, for the same reason the database client has none: the surface is
   three calls and the service-role key must stay server-side.

   THE BUCKET IS PRIVATE AND STAYS PRIVATE. A photo of a bill carries a card
   number often enough that a public URL is not a trade worth making, and a
   signed URL is still a handle that outlives the page it was minted for. Every
   read is proxied by a session-guarded route instead, so the only way to see a
   capture is to be logged into the app.
   =========================================================================== */

export const CAPTURE_BUCKET = 'captures';

/** What the phone may send. HEIC is included because that is what iPhones produce. */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
] as const;

/** Matches the bucket's own limit and the database constraint. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const baseUrl = () => (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const serviceKey = () => process.env.SUPABASE_SERVICE_KEY ?? '';

export function storageConfigured(): boolean {
  return Boolean(baseUrl() && serviceKey());
}

/** SHA-256 of the image, so identical bytes are always the same object. A
    Shortcut or a browser tab that retries on a bad connection re-sends the
    same photo, and a random id would file it as a second one. */
export async function idFromBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `cap-${hex.slice(0, 24)}`;
}

export function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/heic': 'heic', 'image/heif': 'heif',
  };
  return map[mime] ?? 'bin';
}

export function isAllowedImage(mime: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime);
}

/**
 * Put an object in the bucket.
 *
 * `upsert` is off: the path carries the capture id, so a collision would mean
 * two different photos claiming one id, and overwriting would destroy the
 * first. A retry with the same bytes produces the same id and the same path,
 * which the caller treats as already-stored rather than as an error.
 */
export async function putObject(
  path: string,
  body: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  if (!storageConfigured()) throw new Error('Storage is not configured.');

  const res = await fetch(`${baseUrl()}/storage/v1/object/${CAPTURE_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${serviceKey()}`,
      'Content-Type': contentType,
      'cache-control': 'max-age=31536000',
    },
    body: body as BodyInit,
    cache: 'no-store',
  });

  if (res.ok) return;

  /* Already there is SUCCESS, not failure. The path carries a SHA-256 of the
     image, so the same path means the same bytes — a Shortcut retrying over
     bad signal is re-sending the photo it already sent.

     Supabase reports this as HTTP 400 with the real code buried in the body
     ({"statusCode":"409","error":"Duplicate"}), not as an HTTP 409. Checking
     the status alone silently never matched, and every retry came back to the
     phone as an error — which is exactly when the user takes the photo again. */
  const text = await res.text();
  if (res.status === 409 || /KeyAlreadyExists|"statusCode"\s*:\s*"?409|Duplicate/i.test(text)) {
    return;
  }
  throw new Error(`Storage ${res.status}: ${text.slice(0, 200)}`);
}

/** Fetch an object's bytes. Used only by the proxying route. */
export async function getObject(path: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  if (!storageConfigured()) return null;

  const res = await fetch(`${baseUrl()}/storage/v1/object/${CAPTURE_BUCKET}/${path}`, {
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return {
    body: await res.arrayBuffer(),
    type: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}

/**
 * Remove an object.
 *
 * Only called when a capture is discarded, and only after the row is marked —
 * an orphaned row pointing at nothing is recoverable, whereas an image with no
 * row is invisible and will sit in the bucket for ever.
 */
export async function deleteObject(path: string): Promise<void> {
  if (!storageConfigured()) return;
  try {
    const res = await fetch(`${baseUrl()}/storage/v1/object/${CAPTURE_BUCKET}/${path}`, {
      method: 'DELETE',
      // No Content-Type: this request has no body, and sending one makes the
      // storage API reject the call with a 400.
      headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
      cache: 'no-store',
    });
    /* A failure here must not fail the user's action — the row is already
       marked and that is the part that matters. But it must not be SILENT
       either: the image is then exactly the invisible orphan this function
       exists to prevent, and the server log is the only place it can surface. */
    if (!res.ok && res.status !== 404) {
      console.error('[storage] could not delete', path, res.status, (await res.text()).slice(0, 200));
    }
  } catch (err) {
    console.error('[storage] could not delete', path, err instanceof Error ? err.message : err);
  }
}
