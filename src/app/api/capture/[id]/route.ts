import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getCapture } from '@/lib/captures';
import { getObject } from '@/lib/storage';
import { heicToJpeg, isHeic } from '@/lib/image-convert';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Serving one capture's image.

   The bucket is private and every read comes through here, behind the session
   check. A photo of a bill shows a card number often enough that a public URL
   is not a trade worth making — and a signed URL, once minted, outlives the
   page that needed it and can be forwarded by anyone who has it.

   The path is read from the DATABASE ROW, never from the request. Taking it
   from the URL would turn this into a way to read any object in the bucket by
   guessing, which is the classic shape of this bug.
   =========================================================================== */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const { id } = await params;
  const row = await getCapture(id).catch(() => null);
  if (!row) return new NextResponse('Not found', { status: 404 });

  const object = await getObject(row.path);
  if (!object) return new NextResponse('Not found', { status: 404 });

  /* A photo stored before HEIC was converted on arrival is converted here, on
     the way out, so every browser can show it — not only Safari. The cache
     header below makes that a once-per-device cost. If it cannot be
     converted, the original is sent as it always was. */
  let body = object.body;
  let type = row.mime || object.type;
  if (isHeic(type)) {
    try {
      body = await heicToJpeg(body);
      type = 'image/jpeg';
    } catch {
      /* keep the original */
    }
  }

  return new NextResponse(body, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(body.byteLength),
      /* Private, because this is one person's own photo behind their own
         session — and immutable, because the id is a hash of the bytes, so a
         given id can never point at different content. */
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': `inline; filename="${id}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
