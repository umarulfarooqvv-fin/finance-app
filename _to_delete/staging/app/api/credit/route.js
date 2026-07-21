import { NextResponse } from 'next/server';
import { getDb, logEvent } from '@/lib/db';
import { ensureData } from '@/lib/bootstrap';
import { creditLedger, setCreditStatus } from '@/lib/credit';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureData();
    return NextResponse.json({ ok: true, ...creditLedger() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await ensureData();
    const body = await req.json();
    const db = getDb();
    const tx = db.prepare("SELECT id FROM transactions WHERE id=? AND category='Credit Given'").get(body.txId);
    if (!tx) return NextResponse.json({ ok: false, error: 'Credit Given entry not found' }, { status: 404 });

    if (body.action === 'receive') {
      await setCreditStatus({ txId: body.txId, status: 'received' }, db);
      logEvent('credit_received', { txId: body.txId });
    } else if (body.action === 'partial') {
      const amt = parseFloat(body.amount);
      if (!Number.isFinite(amt) || amt <= 0) return NextResponse.json({ ok: false, error: 'Valid amount required' }, { status: 400 });
      await setCreditStatus({ txId: body.txId, status: 'partial', receivedAmount: amt }, db);
      logEvent('credit_partial', { txId: body.txId, amount: amt });
    } else if (body.action === 'reopen') {
      await setCreditStatus({ txId: body.txId, status: 'open' }, db);
      logEvent('credit_reopen', { txId: body.txId });
    } else if (body.action === 'assign') {
      await setCreditStatus({ txId: body.txId, person: (body.person || '').trim() || null }, db);
      logEvent('credit_assign', { txId: body.txId, person: body.person });
    } else {
      return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...creditLedger(db) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
