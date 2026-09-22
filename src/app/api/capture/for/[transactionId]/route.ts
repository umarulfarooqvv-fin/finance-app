import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { select } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Is there already a photo on this entry?

   The edit dialog asks this once, on opening, so it can show the receipt
   instead of an empty picker — and so re-opening an entry never offers to
   attach a second photo over one that is already there.
   =========================================================================== */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ transactionId: string }> },
): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const { transactionId } = await params;
  const rows = await select('captures', {
    filters: { transaction_id: `eq.${transactionId}`, status: 'eq.used' },
    select: 'id,ts,bytes',
    limit: 1,
  }).catch(() => []);

  return NextResponse.json({ ok: true, capture: rows[0] ?? null });
}
