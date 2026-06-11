import { getDb, logEvent } from './db.js';
import { parseCsv, normalizeRows } from './parser.js';

const SHEET_ID = process.env.DAILY_SPENT_SHEET_ID || '1orMNGjhPKlKPTIQDKFcxd48Fip9K5Wuf5FdLkFWyimc';
const TAB = process.env.DAILY_SPENT_TAB || 'Form Responses 1';

export function csvUrl() {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(TAB)}`;
}

/**
 * Pull the sheet and idempotently upsert into SQLite.
 * The sheet is never mutated here. Rows are keyed by sheet_row; if a row's
 * content hash changed (edited in the sheet), we replace it but KEEP any
 * annotation (verified flag) attached to that sheet_row.
 */
export async function syncFromSheet() {
  const res = await fetch(csvUrl(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sheet fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  const rows = normalizeRows(parseCsv(text));

  const db = getDb();
  const existingByRow = new Map(
    db.prepare('SELECT id, sheet_row FROM transactions').all().map((r) => [r.sheet_row, r.id])
  );

  const upsert = db.prepare(`
    INSERT INTO transactions (id, sheet_row, ts_raw, ts, date_only, amount, method, category, remarks, kind, card_affected, card_direction, tags, needs_review, deleted)
    VALUES (@id, @sheetRow, @tsRaw, @ts, @dateOnly, @amount, @method, @category, @remarks, @kind, @cardAffected, @cardDirection, @tags, @needsReview, 0)
    ON CONFLICT(id) DO UPDATE SET
      sheet_row=@sheetRow, ts_raw=@tsRaw, ts=@ts, date_only=@dateOnly, amount=@amount,
      method=@method, category=@category, remarks=@remarks, kind=@kind,
      card_affected=@cardAffected, card_direction=@cardDirection, tags=@tags,
      needs_review=@needsReview, deleted=0
  `);
  const moveAnnotation = db.prepare('UPDATE OR REPLACE annotations SET tx_id=? WHERE tx_id=?');
  const deleteOld = db.prepare('DELETE FROM transactions WHERE sheet_row=? AND id<>?');

  let added = 0, updated = 0;
  const seenRows = new Set();
  const txn = db.transaction(() => {
    for (const t of rows) {
      seenRows.add(t.sheetRow);
      const prevId = existingByRow.get(t.sheetRow);
      if (prevId && prevId !== t.id) {
        // Row content changed in the sheet — carry the annotation over, drop stale copy.
        moveAnnotation.run(t.id, prevId);
        deleteOld.run(t.sheetRow, t.id);
        updated++;
      } else if (!prevId) {
        added++;
      }
      upsert.run({
        ...t,
        dateOnly: t.dateOnly ? 1 : 0,
        needsReview: t.needsReview ? 1 : 0,
        tags: JSON.stringify(t.tags || {}),
      });
    }
    // Rows that vanished from the sheet (deleted there) → soft-delete locally.
    for (const [sheetRow] of existingByRow) {
      if (!seenRows.has(sheetRow)) {
        db.prepare('UPDATE transactions SET deleted=1 WHERE sheet_row=?').run(sheetRow);
      }
    }
  });
  txn();

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_sync', datetime('now','localtime'))").run();
  logEvent('sync', { added, updated, total: rows.length });
  return { added, updated, total: rows.length };
}

export function getLastSync() {
  const r = getDb().prepare("SELECT value FROM settings WHERE key='last_sync'").get();
  return r ? r.value : null;
}
