import { NextResponse } from 'next/server';
import { getDb, logEvent } from '@/lib/db';
import { ensureData } from '@/lib/bootstrap';
import { listDebts, upsertDebt, deleteDebt, addDebtPayment, deleteDebtPayment } from '@/lib/debts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureData();
    return NextResponse.json({ ok: true, ...listDebts() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await ensureData();
    const body = await req.json();
    const db = getDb();
    switch (body.action) {
      case 'saveDebt': {
        const d = await upsertDebt(body.debt || {}, db);
        logEvent('debt_save', { id: d.id, lender: d.lender, principal: d.principal });
        break;
      }
      case 'deleteDebt':
        await deleteDebt(body.id, db);
        logEvent('debt_delete', { id: body.id });
        break;
      case 'addPayment': {
        const p = await addDebtPayment(body.payment || {}, db);
        logEvent('debt_payment', { id: p.id, debt: p.debt_id, amount: p.amount });
        break;
      }
      case 'deletePayment':
        await deleteDebtPayment(body.id, db);
        logEvent('debt_payment_delete', { id: body.id });
        break;
      default:
        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...listDebts(db) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
