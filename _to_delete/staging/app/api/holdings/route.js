import { NextResponse } from 'next/server';
import { getDb, logEvent } from '@/lib/db';
import { ensureData } from '@/lib/bootstrap';
import {
  listHoldings, upsertHolding, deleteHolding,
  listInvoices, upsertInvoice, deleteInvoice,
} from '@/lib/holdings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureData();
    return NextResponse.json({ ok: true, ...listHoldings(), ...listInvoices() });
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
      case 'saveHolding': {
        const h = await upsertHolding(body.holding || {}, db);
        logEvent('holding_save', { id: h.id, kind: h.kind });
        return NextResponse.json({ ok: true, ...listHoldings(db) });
      }
      case 'deleteHolding':
        await deleteHolding(body.id, db);
        return NextResponse.json({ ok: true, ...listHoldings(db) });
      case 'saveInvoice': {
        const inv = await upsertInvoice(body.invoice || {}, db);
        logEvent('invoice_save', { id: inv.id, client: inv.client });
        return NextResponse.json({ ok: true, ...listInvoices(db) });
      }
      case 'deleteInvoice':
        await deleteInvoice(body.id, db);
        return NextResponse.json({ ok: true, ...listInvoices(db) });
      default:
        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
