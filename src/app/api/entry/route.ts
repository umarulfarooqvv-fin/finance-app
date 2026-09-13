import { NextResponse } from 'next/server';
import { invalidateSnapshot } from '@/lib/snapshot';
import { insert, logEvent } from '@/lib/supabase';
import { normaliseEntry, toRow } from '@/lib/entry';
import { buildIncomeRow, incomeIdFromContent } from '@/lib/income';
import { validateIncome, type IncomeInput } from '@/lib/validation';
import { dayOf, nowIST } from '@/lib/time';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Ingestion endpoint for the iPhone "Daily Spent" Shortcut.

   Accepts form-encoded or JSON: amount, method, category, remarks, and an
   optional type=income (which also accepts source/account as aliases, plus an
   explicit ts). Exempt from the PIN lock (see src/proxy.ts) and guarded by
   INGEST_TOKEN instead.

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

    /* Income takes a different table and a different shape.

       `source`/`account` are the real column names; `category`/`method` are
       accepted as aliases so one Shortcut can post either kind with the same
       field names and only a `type` flag to tell them apart. */
    if ((body['type'] ?? '').toLowerCase() === 'income') {
      const source = (body['source'] ?? body['category'] ?? '').trim();
      const account = (body['account'] ?? body['method'] ?? '').trim();
      const remarks = (body['remarks'] ?? '').trim();
      // An explicit date is accepted so a payment can be logged on the day it
      // actually landed; without one the server clock decides, never the phone's.
      const ts = (body['ts'] ?? '').trim() || nowIST();

      const input: IncomeInput = { amount: body['amount'], source, account, remarks, ts };
      const errors = validateIncome(input, dayOf(nowIST()));
      if (errors) {
        return NextResponse.json(
          { ok: false, error: Object.values(errors)[0], fields: errors },
          { status: 400 },
        );
      }

      /* Content-derived, like the spending path. This used to be
         `Math.random()`, which made a Shortcut retry over a flaky connection
         post a SECOND salary rather than upserting the first. */
      const id = await incomeIdFromContent([ts, input.amount ?? '', source, account, remarks]);
      const row = buildIncomeRow(input, id);

      await insert('income', [row], { upsert: true });
      invalidateSnapshot();
      await logEvent('entry.income', { id, amount: row.amount, source, account });
      return NextResponse.json({ ok: true, kind: 'income', id, amount: row.amount });
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
