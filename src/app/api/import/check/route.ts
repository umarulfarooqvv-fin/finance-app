import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getSnapshot } from '@/lib/snapshot';
import { matchAgainstLedger, type MatchableRow } from '@/lib/import-match';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Which of these pasted rows are already in the ledger?

   Importing a month of statement rows means importing over entries that were
   typed at the time. Without this, forty careful expenses go in twice and
   every total silently doubles — and a doubled total is believed, because
   nothing about it looks broken.

   The idempotency key on an import cannot catch this. It is derived from the
   row's own content, so it stops the SAME PASTE doubling itself; a row typed
   by hand in August has a different id and would sail straight through.

   It matches, it does not decide. The reply labels each row and the page
   shows it; what gets imported is still the person's choice, because two
   identical amounts on one day are a real thing and the app cannot tell a
   duplicate from a busy Tuesday.

   Session-guarded, and it reads only. The rows sent here are a subset of what
   Import would send moments later, so this adds no exposure of its own.
   =========================================================================== */

type Body = { rows?: unknown };

const MAX_ROWS = 400;

export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ ok: false, error: 'No rows to check.' }, { status: 400 });
  }
  if (body.rows.length > MAX_ROWS) {
    return NextResponse.json({ ok: false, error: 'Too many rows to check at once.' }, { status: 400 });
  }

  /* Read defensively rather than trusting the shape: this is the only place
     the client's own parse crosses back into server code. */
  const rows: MatchableRow[] = [];
  for (const raw of body.rows) {
    const r = raw as Record<string, unknown>;
    const line = Number(r['line']);
    const amount = Number(r['amount']);
    const day = typeof r['day'] === 'string' ? r['day'] : '';
    if (!Number.isFinite(line) || !Number.isFinite(amount)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    rows.push({
      line,
      day,
      amount,
      method: typeof r['method'] === 'string' ? r['method'] : '',
      category: typeof r['category'] === 'string' ? r['category'] : '',
      remarks: typeof r['remarks'] === 'string' ? r['remarks'] : '',
    });
  }

  const snap = await getSnapshot();
  const matches = matchAgainstLedger(rows, snap);

  /* Everything already recorded across the pasted window, so the page can put
     the two lists beside each other. Deciding whether a row is a duplicate
     from a badge alone asks the reader to trust the match; showing what is
     actually there lets them check it. */
  const days = rows.map((r) => r.day).sort();
  const lo = days[0] ?? '';
  const hi = days[days.length - 1] ?? '';
  const inWindow = snap.transactions
    .filter((t) => !t.deleted && t.ts && t.amount != null
      && t.ts.slice(0, 10) >= lo && t.ts.slice(0, 10) <= hi)
    .map((t) => ({
      id: t.id, ts: t.ts!, amount: t.amount!, method: t.method,
      category: t.category, remarks: t.remarks ?? '',
    }))
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));

  return NextResponse.json({
    ok: true,
    window: { from: lo, to: hi },
    existing: inWindow,
    matches: [...matches.entries()].map(([line, m]) => ({
      line,
      level: m.level,
      // Enough to show WHAT it matched, without shipping the whole row.
      existing: m.existing
        ? {
            id: m.existing.id,
            ts: m.existing.ts,
            amount: m.existing.amount,
            method: m.existing.method,
            category: m.existing.category,
            remarks: m.existing.remarks,
          }
        : null,
    })),
  });
}
