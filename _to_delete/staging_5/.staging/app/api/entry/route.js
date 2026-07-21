import { NextResponse } from 'next/server';
import { appendRow } from '@/lib/sheets';
import { logEvent } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Direct ingestion for the iPhone Shortcut (replaces the Google Form).
// Accepts form-encoded OR JSON: amount, method, category, remarks [, type=income, source, account].
// Auth: INGEST_TOKEN via ?token= or x-token header (skipped only if unset).
// Exempt from the PIN lock in middleware.js.
async function parseBody(req) {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) return req.json();
  const fd = await req.formData();
  return Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
}

export async function POST(req) {
  try {
    const token = process.env.INGEST_TOKEN;
    const url = new URL(req.url);
    const provided = url.searchParams.get('token') || req.headers.get('x-token');
    if (token && provided !== token) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const d = await parseBody(req);
    const amount = d.amount ?? d.Upi ?? d.upi ?? d.payment ?? d.Payment;
    const method = d.method ?? d.Method;
    const category = d.category ?? d.Category;
    const remarks = d.remarks ?? d.Remarks ?? '';
    const type = String(d.type || '').toLowerCase();

    if (amount == null || amount === '') {
      return NextResponse.json({ ok: false, error: 'amount required' }, { status: 400 });
    }

    let res;
    if (type === 'income') {
      res = await appendRow({
        tab: process.env.DAILY_INCOME_TAB || 'Form Responses 2',
        amount, remarks, source: d.source ?? category ?? '', account: d.account ?? d.bank ?? '',
      });
      logEvent('entry_income', { id: res.row });
    } else {
      res = await appendRow({ amount, method, category, remarks, source: 'shortcut' });
      logEvent('entry_spend', { id: res.row, method, category });
    }
    return NextResponse.json({ ok: true, id: res.row });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: 'POST amount, method, category, remarks (form-encoded or JSON). Add ?token=INGEST_TOKEN.',
  });
}
