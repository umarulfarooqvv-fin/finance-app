import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cardStatement } from '@/lib/cycles';
import { ensureData } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export async function GET(req, ctx) {
  await ensureData();
  const { name } = await ctx.params;
  const db = getDb();
  const card = db.prepare('SELECT * FROM cards WHERE name=?').get(decodeURIComponent(name));
  if (!card) return NextResponse.json({ ok: false, error: 'Card not found' }, { status: 404 });

  const stmt = cardStatement(card);
  const nowIso = new Date().toISOString().slice(0, 19);

  const ledger = (fromIso, toIso) => db.prepare(`
    SELECT t.*, COALESCE(a.verified,0) verified
    FROM transactions t LEFT JOIN annotations a ON a.tx_id=t.id
    WHERE t.deleted=0 AND t.card_affected=? AND t.ts>? AND t.ts<=?
    ORDER BY t.ts ASC
  `).all(card.name, fromIso, toIso);

  // Bill view: the last generated statement's cycle (cycleStart..statementEnd)
  const billRows = ledger(isoMinus(stmt.cycleStart), stmt.statementEnd);
  // Live/unbilled view: after statementEnd, up to now
  const liveRows = ledger(stmt.statementEnd, nowIso);

  const verifiedSum = (rows) => rows.filter((r) => r.verified && r.card_direction === 'debt+').reduce((a, r) => a + (r.amount || 0), 0);
  const unverifiedSum = (rows) => rows.filter((r) => !r.verified && r.card_direction === 'debt+').reduce((a, r) => a + (r.amount || 0), 0);

  // Activity timeline (latest 40 events on this card)
  const activity = db.prepare(`
    SELECT t.* FROM transactions t
    WHERE t.deleted=0 AND t.card_affected=? AND t.ts<=?
    ORDER BY t.ts DESC LIMIT 40
  `).all(card.name, nowIso);

  return NextResponse.json({
    ok: true,
    card: { name: card.name, color: card.color, billDate: card.bill_date, graceDays: card.grace_days, creditLimit: card.credit_limit },
    statement: stmt,
    billRows,
    liveRows,
    reconciliation: {
      billVerified: round2(verifiedSum(billRows)),
      billUnverified: round2(unverifiedSum(billRows)),
      liveVerified: round2(verifiedSum(liveRows)),
      liveUnverified: round2(unverifiedSum(liveRows)),
    },
    activity,
  });
}

function isoMinus(s) {
  const d = new Date(s);
  d.setSeconds(d.getSeconds() - 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function round2(n) { return Math.round(n * 100) / 100; }
