import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { select } from '@/lib/supabase';
import { checkEntryAgainstPhoto } from '@/lib/photo-check';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* ===========================================================================
   Check an existing entry against the photo attached to it, now.

   New photos are checked as they are attached. This is for the ones attached
   before that existed, and for trying again after the AI limit lifts. Same
   rules, same notice, same undo — see lib/photo-method.
   =========================================================================== */

export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { transactionId?: unknown };
  const transactionId = typeof body.transactionId === 'string' ? body.transactionId.trim() : '';
  if (!transactionId) return NextResponse.json({ ok: false, error: 'Missing entry.' }, { status: 400 });

  const [capture] = await select('captures', {
    filters: { transaction_id: `eq.${transactionId}`, status: 'eq.used' },
    select: 'id',
    limit: 1,
  });
  if (!capture) return NextResponse.json({ ok: false, error: 'That entry has no photo.' }, { status: 404 });

  const outcome = await checkEntryAgainstPhoto(capture.id, transactionId, auth.ctx.via);
  return NextResponse.json({ ok: true, outcome });
}
