import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getCapture } from '@/lib/captures';
import { getObject } from '@/lib/storage';
import { readReceipts, visionConfigured, type VisionImage } from '@/lib/ai/vision';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* ===========================================================================
   Turning photos already sitting in the capture inbox into paste-rows text.

   A capture is never touched by this — no status changes, nothing is marked
   used. It only reads the bytes already in the bucket and hands them to the
   same reader /api/import/vision uses for a fresh upload, so the two paths
   produce the identically-shaped text and land in the identical reviewable
   table on /import.
   =========================================================================== */

const MAX_IDS = 12;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

type Body = { ids?: unknown };

export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  if (!visionConfigured()) {
    return bad('Photo conversion is not set up. See IMPORT_AI in .env.example.', 501);
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
  if (ids.length === 0) return bad('No photos were selected.');
  if (ids.length > MAX_IDS) return bad(`Too many at once — convert at most ${MAX_IDS} together.`);

  const images: VisionImage[] = [];
  for (const id of ids) {
    const row = await getCapture(id);
    if (!row) return bad(`One of those photos could not be found.`);
    const object = await getObject(row.path);
    if (!object) return bad(`One of those photos could not be read from storage.`);
    images.push({ bytes: object.body, mime: row.mime });
  }

  const result = await readReceipts(images);
  if (!result.ok) return bad(result.error, 502);
  return NextResponse.json({ ok: true, text: result.text });
}
