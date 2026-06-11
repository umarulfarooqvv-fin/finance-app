import { NextResponse } from 'next/server';
import { ensureData } from '@/lib/bootstrap';
import { statementView } from '@/lib/cycles';
import { recurringOverview } from '@/lib/recurring';

// Daily alert check — hit by the Vercel cron (vercel.json) every morning.
// Sends a push via ntfy.sh when a card is Overdue / Due Soon or a recurring
// item is due to post. Subscribe to your topic in the ntfy app (iOS/Android)
// or at https://ntfy.sh/<your topic>.
//
// Exempt from the PIN lock; protected by CRON_SECRET instead (Vercel sends it
// automatically as a Bearer token when the env var exists). The response
// never includes amounts unless authorized.

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureData();
    const v = statementView();
    const lines = [];

    for (const r of v.rows) {
      if (r.status === 'Overdue') {
        lines.push(`🔴 ${r.card}: OVERDUE — ₹${fmt(r.remainingDueBill)} was due ${r.dueDate.slice(0, 10)}`);
      } else if (r.status === 'Due Soon') {
        lines.push(`⚠️ ${r.card}: ₹${fmt(r.remainingDueBill)} due in ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} (${r.dueDate.slice(0, 10)})`);
      }
    }

    let rec = null;
    try { rec = recurringOverview(); } catch {}
    if (rec && rec.dueCount > 0) {
      lines.push(`📌 ${rec.dueCount} recurring item${rec.dueCount > 1 ? 's' : ''} due to post (EMI/subscription)`);
    }

    let pushed = false;
    const topic = process.env.NTFY_TOPIC;
    if (topic && lines.length > 0) {
      const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: {
          Title: 'Finance: payment alerts',
          Priority: lines.some((l) => l.startsWith('🔴')) ? 'high' : 'default',
          Tags: 'credit_card',
        },
        body: lines.join('\n'),
      });
      pushed = res.ok;
    }

    return NextResponse.json({ ok: true, alerts: lines.length, pushed, lines });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

function fmt(n) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}
