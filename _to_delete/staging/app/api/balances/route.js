import { NextResponse } from 'next/server';
import { getDb, logEvent } from '@/lib/db';
import { ensureData } from '@/lib/bootstrap';
import { accountBalances, setOpeningBalance, setBalanceSince } from '@/lib/balances';
import { writesEnabled, setConfig } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureData();
    return NextResponse.json({ ok: true, ...accountBalances() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    await ensureData();
    const body = await req.json();
    const db = getDb();
    if (body.account !== undefined && body.opening !== undefined) {
      setOpeningBalance(body.account, parseFloat(body.opening) || 0, db);
      logEvent('opening_balance', { account: body.account, opening: body.opening });
    }
    if (body.since !== undefined) {
      setBalanceSince(body.since || null, db);
      logEvent('balance_since', { since: body.since });
    }
    // Persist account settings to the sheet (survives serverless cold starts)
    if (writesEnabled()) {
      const accounts = db.prepare('SELECT * FROM accounts').all();
      const since = db.prepare("SELECT value FROM settings WHERE key='balance_since'").get();
      await setConfig('accounts', JSON.stringify({ accounts, since: since ? since.value : null })).catch(() => {});
    }
    return NextResponse.json({ ok: true, ...accountBalances(db) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
