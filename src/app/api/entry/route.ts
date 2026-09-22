import { NextResponse } from 'next/server';
import { invalidateSnapshot } from '@/lib/snapshot';
import { insert, logEvent } from '@/lib/supabase';
import { normaliseEntry, toRow } from '@/lib/entry';
import { buildIncomeRow, incomeIdFromContent } from '@/lib/income';
import { attachPhoto } from '@/lib/captures';
import { isValidInstant, validateIncome, type IncomeInput } from '@/lib/validation';
import { dayOf, nowIST } from '@/lib/time';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Ingestion endpoint for the iPhone "Daily Spent" Shortcut.

   Accepts form-encoded or JSON: amount, method, category, remarks, an optional
   ts, and an optional type=income (which also accepts source/account as
   aliases for method/category). Exempt from the PIN lock (see src/proxy.ts)
   and guarded by INGEST_TOKEN instead.

   Send the token as the x-token HEADER. The ?token= query form still works for
   older Shortcut versions, but query strings are recorded in Vercel's request
   logs, so the header is the one to use.

   A PHOTO IS OPTIONAL AND ADDITIVE. Posting multipart/form-data with a File
   field attaches it to the entry this same request creates — one Shortcut
   step instead of a separate trip through /api/capture and the inbox. If the
   upload fails, the entry itself is not rolled back: the money already
   landed, and a lost photo is a worse trade than a lost entry. The response
   says which happened.
   =========================================================================== */

function unauthorised() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
}

type ParsedBody = { fields: Record<string, string>; photo: File | null };

async function readBody(req: Request): Promise<ParsedBody> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      fields: Object.fromEntries(Object.entries(json).map(([k, v]) => [k, String(v ?? '')])),
      photo: null,
    };
  }
  // Handles both application/x-www-form-urlencoded and multipart/form-data —
  // the latter is how a photo rides alongside the text fields.
  const form = await req.formData().catch(() => null);
  if (!form) return { fields: {}, photo: null };
  const fields: Record<string, string> = {};
  let photo: File | null = null;
  for (const [k, v] of form.entries()) {
    if (v instanceof File) { if (v.size > 0 && !photo) photo = v; }
    else fields[k] = String(v);
  }
  return { fields, photo };
}

export async function POST(req: Request): Promise<Response> {
  try {
    const expected = process.env.INGEST_TOKEN;
    const provided = req.headers.get('x-token') ?? new URL(req.url).searchParams.get('token');
    if (expected && provided !== expected) return unauthorised();

    const { fields: body, photo } = await readBody(req);

    /* A photo posted alongside `type=income` has nowhere to attach — captures
       point at a transaction, and income is a different table. Silently
       dropped rather than rejecting the whole entry over an optional extra. */

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

    /* An explicit `ts` is accepted here for the same reason it is on income:
       an entry typed hours later — from a photo in the inbox, or from memory
       on the way home — should be dated when the money was actually spent.
       Income already took one; spending did not, and normaliseEntry has always
       supported it. Anything malformed falls back to the server clock rather
       than being stored as a date that drops the row out of every total. */
    const explicitTs = (body['ts'] ?? '').trim();
    const entry = await normaliseEntry({
      amount: body['amount'],
      method: body['method'],
      category: body['category'],
      remarks: body['remarks'],
      ts: isValidInstant(explicitTs) ? explicitTs : null,
    });

    if (entry.amount === null) {
      return NextResponse.json({ ok: false, error: 'amount is required' }, { status: 400 });
    }

    // Upsert: the id is derived from the content, so a Shortcut that retries
    // on a flaky connection updates the same row instead of double-counting.
    await insert('transactions', [toRow(entry)], { upsert: true });
    invalidateSnapshot();
    await logEvent('entry.transaction', { id: entry.id, amount: entry.amount, kind: entry.kind });

    /* Attached last, after the money is safely recorded. A photo that fails
       to upload — a dropped connection, a bad file — must not undo an entry
       that already landed; `photoError` says so without a 500. */
    let photoError: string | null = null;
    if (photo) {
      const result = await attachPhoto({
        bytes: await photo.arrayBuffer(),
        mime: (photo.type || 'image/jpeg').toLowerCase(),
        ts: entry.ts ?? nowIST(),
        note: '',
        transactionId: entry.id,
        source: 'shortcut',
        actor: 'shortcut',
      }).catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
      if (!result.ok) photoError = result.error;
    }

    return NextResponse.json({
      ok: true,
      id: entry.id,
      kind: entry.kind,
      photo: photo ? photoError === null : undefined,
      photoError: photoError ?? undefined,
      card: entry.cardAffected,
      needsReview: entry.needsReview,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
