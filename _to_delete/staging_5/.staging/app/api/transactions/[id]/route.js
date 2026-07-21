import { NextResponse } from 'next/server';
import { getDb, logEvent } from '@/lib/db';
import { updateRow, setMeta, writesEnabled } from '@/lib/sheets';
import { loadFromStore } from '@/lib/sync';

export const dynamic = 'force-dynamic';

export async function PATCH(req, ctx) {
  const { id } = await ctx.params;
  const db = getDb();
  const tx = db.prepare('SELECT * FROM transactions WHERE id=?').get(id);
  if (!tx) return NextResponse.json({ ok: false, error: 'Transaction not found' }, { status: 404 });

  try {
    const body = await req.json();

    // --- Verify / unverify (reconciliation) ---
    if (body.action === 'verify') {
      const verified = body.verified ? 1 : 0;
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO annotations (tx_id, verified, verified_at, note, synced_to_sheet)
        VALUES (?,?,?,?,0)
        ON CONFLICT(tx_id) DO UPDATE SET verified=excluded.verified, verified_at=excluded.verified_at, synced_to_sheet=0
      `).run(id, verified, now, body.note || null);
      let sheetSynced = false;
      if (writesEnabled()) {
        try {
          await setMeta({ txId: id, row: tx.sheet_row, verified: Boolean(verified), note: body.note || '' });
          db.prepare('UPDATE annotations SET synced_to_sheet=1 WHERE tx_id=?').run(id);
          sheetSynced = true;
        } catch { /* stays queued locally; next verify or sync can retry */ }
      }
      logEvent('verify', { id, verified, sheetSynced });
      return NextResponse.json({ ok: true, verified: Boolean(verified), sheetSynced });
    }

    // --- Edit row content (writes back to the sheet, then re-syncs) ---
    if (body.action === 'edit') {
      const { amount, method, category, remarks, timestamp } = body;
      await updateRow({
        row: tx.sheet_row,
        timestamp: timestamp ?? tx.ts_raw,
        amount: amount ?? tx.amount,
        method: method ?? tx.method,
        category: category ?? tx.category,
        remarks: remarks ?? tx.remarks,
      });
      logEvent('edit', { id, row: tx.sheet_row, amount, method, category, remarks });
      const sync = await loadFromStore();
      return NextResponse.json({ ok: true, sync });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
