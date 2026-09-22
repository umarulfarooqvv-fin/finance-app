import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { attachPhoto } from '@/lib/captures';
import { storageConfigured } from '@/lib/storage';
import { isValidInstant } from '@/lib/validation';
import { nowIST } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* ===========================================================================
   Attaching a photo to an entry from the app itself.

   This is the New Entry dialog's "add a photo" — a person filling the form
   right now, with the receipt already on their phone. It lands DIRECTLY on
   the transaction, `status: 'used'` from the first write, and never shows up
   in the inbox: it was never waiting for anything.

   Session-guarded rather than INGEST_TOKEN — this call only ever comes from
   a signed-in browser tab, so it uses the same check every other write in the
   app does, not the Shortcut's separate door.
   =========================================================================== */

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  if (!storageConfigured()) return bad('Storage is not configured on the server.', 500);

  const form = await req.formData().catch(() => null);
  if (!form) return bad('Could not read the form data.');

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return bad('No photo was attached.');

  const transactionId = String(form.get('transactionId') ?? '').trim();
  if (!transactionId) return bad('Missing which entry this photo belongs to.');

  const note = String(form.get('note') ?? '');
  const tsRaw = String(form.get('ts') ?? '');
  const ts = isValidInstant(tsRaw) ? tsRaw : nowIST();
  const mime = (file.type || 'image/jpeg').toLowerCase();

  try {
    const result = await attachPhoto({
      bytes: await file.arrayBuffer(),
      mime,
      ts,
      note,
      transactionId,
      source: 'app',
      actor: auth.ctx.actor,
    });
    if (!result.ok) return bad(result.error);
    return NextResponse.json({ ok: true, id: result.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
