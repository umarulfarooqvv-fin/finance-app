import { NextResponse } from 'next/server';
import { invalidateSnapshot } from '../../../data/snapshot.ts';
import { insert, logEvent } from '../../../data/supabase.ts';
import { normaliseEntry, toRow } from '../../../domain/entry.ts';
import { nowIST } from '../../../domain/time.ts';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Ingestion endpoint for the iPhone "Daily Spent" Shortcut.

   Accepts form-encoded or JSON: amount, method, category, remarks, and an
   optional type=income. Exempt from the PIN lock (see src/middleware.ts) and
   guarded by INGEST_TOKEN instead.

   Send the token as the x-token HEADER. The ?token= query form still works for
   older Shortcut versions, but query strings are recorded in Vercel's request
   logs, so the header is the one to use.
   =========================================================================== */

function unauthorised() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
}

async function readBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, String(v ?? '')]));
  }
  const form = await req.formData().catch(() => null);
  if (!form) return {};
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
}

export async function POST(req: Request): Promise<Response> {
  try {
    const expected = process.env.INGEST_TOKEN;
    const provided = req.headers.get('x-token') ?? new URL(req.url).searchParams.get('token');
    if (expected && provided !== expected) return unauthorised();

    const body = await readBody(req);

    // Income takes a different table and a different shape.
    if ((body['type'] ?? '').toLowerCase() === 'income') {
      const amount = Number(String(body['amount'] ?? '').replace(/[₹,\s]/g, ''));
      if (!Number.isFinite(amount)) {
        return NextResponse.json({ ok: false, error: 'amount is required' }, { status: 400 });
      }
      const ts = nowIST();
      const row = {
        id: `inc-${ts.replace(/\D/g, '')}-${Math.random().toString(36).slice(2, 8)}`,
        ts,
        amount,
        source: (body['category'] ?? body['source'] ?? '').trim(),
        account: (body['method'] ?? body['account'] ?? '').trim(),
        remarks: (body['remarks'] ?? '').trim(),
        needs_review: false,
        deleted: false,
      };
      await insert('income', [row], { upsert: true });
      invalidateSnapshot();
      await logEvent('entry.income', { id: row.id, amount });
      return NextResponse.json({ ok: true, kind: 'income', id: row.id });
    }

    const entry = await normaliseEntry({
      amount: body['amount'],
      method: body['method'],
      category: body['category'],
      remarks: body['remarks'],
    });

    if (entry.amount === null) {
      return NextResponse.json({ ok: false, error: 'amount is required' }, { status: 400 });
    }

    // Upsert: the id is derived from the content, so a Shortcut that retries
    // on a flaky connection updates the same row instead of double-counting.
    await insert('transactions', [toRow(entry)], { upsert: true });
    invalidateSnapshot();
    await logEvent('entry.transaction', { id: entry.id, amount: entry.amount, kind: entry.kind });

    return NextResponse.json({
      ok: true,
      id: entry.id,
      kind: entry.kind,
      card: entry.cardAffected,
      needsReview: entry.needsReview,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
