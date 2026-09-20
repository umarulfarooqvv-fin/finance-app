import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSnapshot } from '@/lib/snapshot';
import { duesToNotify } from '@/lib/upcoming';
import { composeDigest, pushConfigured, sendToAll } from '@/lib/push';
import { remindersFrom } from '@/lib/reminders';
import { dayOf, nowIST } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/* ===========================================================================
   The daily run that decides whether to say anything.

   Called by Vercel Cron. Vercel signs its own calls with CRON_SECRET, and
   without that secret configured this endpoint refuses everyone — an open URL
   that makes a phone buzz is a nuisance anyone on the internet can inflict.

   IT SENDS NOTHING MOST DAYS. `duesToNotify` returns only what lands exactly
   on a configured lead day, so a bill due on the 23rd produces one message on
   the 20th and one on the 23rd, not four days of the same sentence. Silence is
   the normal outcome and is reported as success.

   It writes nothing to the ledger. The worst a bug here can do is send a
   message nobody wanted, never change a figure.
   =========================================================================== */

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) return false;
  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<Response> {
  if (!authorised(req)) return new Response('Not found', { status: 404 });

  const snap = await getSnapshot();
  const today = dayOf(nowIST());
  const settings = remindersFrom(snap.config);

  if (!settings.pushEnabled) {
    return NextResponse.json({ ok: true, today, skipped: 'push disabled' });
  }
  if (!pushConfigured()) {
    return NextResponse.json({ ok: true, today, skipped: 'no VAPID keys' });
  }

  const dues = duesToNotify(snap, today, settings.leadDays);
  const payload = composeDigest(dues, settings.showAmounts);
  if (!payload) return NextResponse.json({ ok: true, today, due: 0, sent: 0 });

  const report = await sendToAll(payload);
  return NextResponse.json({ ok: true, today, due: dues.length, ...report });
}
