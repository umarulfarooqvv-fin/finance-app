import { NextResponse } from 'next/server';
import { syncFromSheet, getLastSync } from '@/lib/sync';
import { getDb } from '@/lib/db';
import { writesEnabled, getMeta } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await syncFromSheet();
    // Hydrate verified flags stored in the sheet's AppMeta tab
    let metaPulled = 0;
    if (writesEnabled()) {
      try {
        const { meta } = await getMeta();
        const db = getDb();
        const up = db.prepare(`
          INSERT INTO annotations (tx_id, verified, verified_at, note, synced_to_sheet)
          VALUES (?,?,?,?,1)
          ON CONFLICT(tx_id) DO UPDATE SET verified=excluded.verified, verified_at=excluded.verified_at, note=excluded.note, synced_to_sheet=1
        `);
        for (const m of meta || []) {
          if (!m.txId) continue;
          up.run(m.txId, m.verified ? 1 : 0, m.verifiedAt || null, m.note || null);
          metaPulled++;
        }
      } catch { /* meta hydration is best-effort */ }
    }
    return NextResponse.json({ ok: true, ...result, metaPulled, lastSync: getLastSync() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, lastSync: getLastSync(), writesEnabled: writesEnabled() });
}
