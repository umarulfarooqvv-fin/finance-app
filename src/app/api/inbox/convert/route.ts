import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import {
  readCapture, readCaptureDrafts, saveCaptureDrafts, type CaptureDraft,
} from '@/lib/capture-drafts';
import { visionConfigured } from '@/lib/ai/vision';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* ===========================================================================
   The rows read out of inbox photos.

   Normally there is nothing to do here: /api/capture already read the photo
   the moment it arrived and the answer is stored. This covers the cases that
   missed that — a photo that landed while IMPORT_AI was off, a backlog from
   before any of this existed, or a read that failed and is worth retrying.

   Returns one draft per id, cached where possible, so opening the inbox does
   not spend a model call on an answer it already has. `refresh` forces a
   re-read of the ones asked for.

   A capture is never touched: no status change, nothing marked used. This
   produces TEXT for /import to show, and a photo stops being "waiting" only
   when a person turns it into an entry.
   =========================================================================== */

const MAX_IDS = 8;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

type Body = { ids?: unknown; refresh?: unknown };

export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  if (!visionConfigured()) {
    return bad('Photo reading is not set up. See IMPORT_AI in .env.example.', 501);
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
  const refresh = body.refresh === true;

  if (ids.length === 0) return bad('No photos were named.');
  if (ids.length > MAX_IDS) return bad(`Too many at once — ask for at most ${MAX_IDS}.`);

  const cached = refresh ? {} : await readCaptureDrafts();
  const drafts: Record<string, CaptureDraft> = {};
  const fresh: Record<string, CaptureDraft> = {};

  for (const id of ids) {
    const have = cached[id];
    // A stored error is worth retrying; a stored reading is not.
    if (have?.text) { drafts[id] = have; continue; }
    const read = await readCapture(id);
    if (read) { drafts[id] = read; fresh[id] = read; }
  }

  // One write for the batch rather than one per photo.
  await saveCaptureDrafts(fresh);

  return NextResponse.json({ ok: true, drafts });
}
