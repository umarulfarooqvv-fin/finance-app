import { NextResponse } from 'next/server';
import { getDb, logEvent } from '@/lib/db';
import { ensureData, saveCardConfig } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureData();
  const cards = getDb().prepare('SELECT * FROM cards ORDER BY name').all();
  return NextResponse.json({ ok: true, cards });
}

export async function PUT(req) {
  try {
    const { name, bill_date, grace_days, credit_limit, color, active } = await req.json();
    const db = getDb();
    const existing = db.prepare('SELECT name FROM cards WHERE name=?').get(name);
    if (existing) {
      db.prepare('UPDATE cards SET bill_date=?, grace_days=?, credit_limit=?, color=?, active=? WHERE name=?')
        .run(bill_date, grace_days, credit_limit || 0, color || '#888', active ? 1 : 0, name);
    } else {
      db.prepare('INSERT INTO cards (name, bill_date, grace_days, credit_limit, color, active) VALUES (?,?,?,?,?,?)')
        .run(name, bill_date, grace_days, credit_limit || 0, color || '#888', active ? 1 : 0);
    }
    logEvent('card_settings', { name, bill_date, grace_days, credit_limit, active });
    // Persist settings to the sheet's AppConfig tab so they survive
    // serverless cold starts (best-effort; works once Apps Script is updated).
    const persisted = await saveCardConfig(db).catch(() => false);
    return NextResponse.json({ ok: true, persisted });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
