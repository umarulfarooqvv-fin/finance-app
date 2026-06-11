import crypto from 'crypto';
import { getDb, logEvent } from './db.js';
import { parseCsv, normalizeRows, parseTimestamp, localIso } from './parser.js';

const SHEET_ID = process.env.DAILY_SPENT_SHEET_ID || '1orMNGjhPKlKPTIQDKFcxd48Fip9K5Wuf5FdLkFWyimc';
const TAB = process.env.DAILY_SPENT_TAB || 'Form Responses 1';
export const INCOME_TAB = process.env.DAILY_INCOME_TAB || 'Form Responses 2';

export function csvUrl(tab = TAB) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
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

  // --- Income tab (Form Responses 2): Timestamp | Payment Received | Source | Bank Account | Remarks
  let income = { added: 0, total: 0 };
  try {
    income = await syncIncome(db);
  } catch { /* income tab is optional — tolerate absence */ }

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_sync', datetime('now','localtime'))").run();
  logEvent('sync', { added, updated, total: rows.length, income });
  return { added, updated, total: rows.length, income };
}

async function syncIncome(db) {
  const res = await fetch(csvUrl(INCOME_TAB), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Income tab fetch failed: HTTP ${res.status}`);
  const csvRows = parseCsv(await res.text());
  const upsert = db.prepare(`
    INSERT INTO income (id, sheet_row, ts_raw, ts, amount, source, account, remarks, needs_review, deleted)
    VALUES (@id, @sheetRow, @tsRaw, @ts, @amount, @source, @account, @remarks, @needsReview, 0)
    ON CONFLICT(id) DO UPDATE SET sheet_row=@sheetRow, ts_raw=@tsRaw, ts=@ts, amount=@amount,
      source=@source, account=@account, remarks=@remarks, needs_review=@needsReview, deleted=0
  `);
  const existing = new Set(db.prepare('SELECT id FROM income').all().map((r) => r.id));
  const seen = new Set();
  let added = 0, total = 0;
  const txn = db.transaction(() => {
    for (let i = 1; i < csvRows.length; i++) {
      const [tsRaw = '', amtRaw = '', source = '', account = '', remarks = ''] = csvRows[i];
      if (!tsRaw.trim() && !amtRaw.trim() && !source.trim()) continue;
      const sheetRow = i + 1;
      const ts = parseTimestamp(tsRaw);
      const amount = amtRaw.trim() === '' ? null : parseFloat(amtRaw.replace(/,/g, ''));
      const id = 'inc-' + crypto.createHash('sha1')
        .update([sheetRow, tsRaw, amtRaw, source, account, remarks].join('')).digest('hex').slice(0, 16);
      seen.add(id);
      if (!existing.has(id)) added++;
      upsert.run({
        id, sheetRow, tsRaw,
        ts: ts ? localIso(ts.date) : null,
        amount: Number.isFinite(amount) ? amount : null,
        source: source.trim(), account: account.trim(), remarks: remarks.trim(),
        needsReview: !ts || !Number.isFinite(amount) ? 1 : 0,
      });
      total++;
    }
    for (const id of existing) {
      if (!seen.has(id)) db.prepare('UPDATE income SET deleted=1 WHERE id=?').run(id);
    }
  });
  txn();
  return { added, total };
}

export function getLastSync() {
  const r = getDb().prepare("SELECT value FROM settings WHERE key='last_sync'").get();
  return r ? r.value : null;
}
