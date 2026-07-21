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
 * Fetch a sheet tab as a 2D array (header at index 0). Used only by the
 * one-time history importer and the test suite — the live app reads from
 * Postgres via loadFromStore(). For filter-proof full-history import, prefer
 * the Apps Script getData endpoint if APPS_SCRIPT_URL/TOKEN are set; else CSV.
 */
async function fetchTabRows(tab) {
  const url = process.env.APPS_SCRIPT_URL;
  const token = process.env.APPS_SCRIPT_TOKEN;
  if (url && token) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token, action: 'getData', tab }),
        redirect: 'follow',
      });
      const json = JSON.parse(await res.text());
      if (json.ok && Array.isArray(json.rows)) {
        return { rows: [['Timestamp', 'B', 'C', 'D', 'E'], ...json.rows], source: 'apps-script' };
      }
    } catch { /* fall through to CSV */ }
  }
  const res = await fetch(csvUrl(tab), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sheet fetch failed (${tab}): HTTP ${res.status}`);
  return { rows: parseCsv(await res.text()), source: 'csv' };
}

/**
 * Pull the sheet and idempotently upsert into SQLite.
 * The sheet is never mutated here. Rows are keyed by sheet_row; if a row's
 * content hash changed (edited in the sheet), we replace it but KEEP any
 * annotation (verified flag) attached to that sheet_row.
 */
export async function syncFromSheet() {
  const fetched = await fetchTabRows(TAB);
  const rows = normalizeRows(fetched.rows);

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
  logEvent('sync', { added, updated, total: rows.length, income, source: fetched.source });
  return { added, updated, total: rows.length, income, source: fetched.source };
}

async function syncIncome(db) {
  const { rows: csvRows } = await fetchTabRows(INCOME_TAB);
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

// ---------------------------------------------------------------------------
// Primary loader for the live app: pull transactions + income from Postgres
// (Supabase) into the SQLite compute cache. Fast single query; the whole
// analytics/credit engine then runs unchanged over the cache.
// ---------------------------------------------------------------------------
export async function loadFromStore() {
  const { select } = await import('./store.js');
  const db = getDb();
  const [txRows, incRows] = await Promise.all([
    select('transactions', { order: 'ts.asc', limit: 200000 }),
    select('income', { order: 'ts.asc', limit: 200000 }),
  ]);

  const upTx = db.prepare(`
    INSERT INTO transactions (id, sheet_row, ts_raw, ts, date_only, amount, method, category, remarks, kind, card_affected, card_direction, tags, needs_review, deleted)
    VALUES (@id, @sheet_row, @ts, @ts, 0, @amount, @method, @category, @remarks, @kind, @card_affected, @card_direction, @tags, @needs_review, @deleted)
  `);
  const upAnn = db.prepare('INSERT OR REPLACE INTO annotations (tx_id, verified, synced_to_sheet) VALUES (?,1,1)');
  const upInc = db.prepare(`
    INSERT INTO income (id, sheet_row, ts_raw, ts, amount, source, account, remarks, needs_review, deleted)
    VALUES (@id, @sheet_row, @ts, @ts, @amount, @source, @account, @remarks, @needs_review, @deleted)
  `);
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  const run = db.transaction(() => {
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM annotations').run();
    db.prepare('DELETE FROM income').run();
    let i = 0;
    for (const t of txRows || []) {
      i += 1;
      upTx.run({
        id: t.id, sheet_row: i, ts: t.ts,
        amount: num(t.amount), method: t.method || '', category: t.category || '', remarks: t.remarks || '',
        kind: t.kind, card_affected: t.card_affected, card_direction: t.card_direction,
        tags: typeof t.tags === 'string' ? t.tags : JSON.stringify(t.tags || {}),
        needs_review: t.needs_review ? 1 : 0, deleted: t.deleted ? 1 : 0,
      });
      if (t.verified) upAnn.run(t.id);
    }
    let j = 0;
    for (const r of incRows || []) {
      j += 1;
      upInc.run({
        id: r.id, sheet_row: j, ts: r.ts, amount: num(r.amount),
        source: r.source || '', account: r.account || '', remarks: r.remarks || '',
        needs_review: r.needs_review ? 1 : 0, deleted: r.deleted ? 1 : 0,
      });
    }
  });
  run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_sync', datetime('now','localtime'))").run();
  return { added: (txRows || []).length, total: (txRows || []).length, income: { total: (incRows || []).length }, source: 'supabase' };
}

// ---------------------------------------------------------------------------
// One-time history import: read the full Google Sheet (filter-proof via Apps
// Script when APPS_SCRIPT_URL/TOKEN are set, else CSV) and return rows shaped
// for the Postgres store. Ids are deterministic per sheet row so re-running
// the import upserts rather than duplicates.
// ---------------------------------------------------------------------------
export async function sheetRowsForImport() {
  const txFetched = await fetchTabRows(TAB);
  const transactions = normalizeRows(txFetched.rows).map((t) => ({
    id: t.id,
    ts: t.ts,
    amount: t.amount,
    method: t.method,
    category: t.category,
    remarks: t.remarks,
    kind: t.kind,
    card_affected: t.cardAffected,
    card_direction: t.cardDirection,
    tags: t.tags || {},
    verified: false,
    needs_review: Boolean(t.needsReview),
    deleted: false,
    source: 'import',
  }));

  const income = [];
  try {
    const incFetched = await fetchTabRows(INCOME_TAB);
    const rows = incFetched.rows;
    for (let i = 1; i < rows.length; i++) {
      const [tsRaw = '', amtRaw = '', source = '', account = '', remarks = ''] = rows[i];
      if (!tsRaw.trim() && !amtRaw.trim() && !source.trim()) continue;
      const ts = parseTimestamp(tsRaw);
      const amount = amtRaw.trim() === '' ? null : parseFloat(amtRaw.replace(/,/g, ''));
      const id = 'inc-' + crypto.createHash('sha1')
        .update([i + 1, tsRaw, amtRaw, source, account, remarks].join('')).digest('hex').slice(0, 16);
      income.push({
        id, ts: ts ? localIso(ts.date) : null,
        amount: Number.isFinite(amount) ? amount : null,
        source: source.trim(), account: account.trim(), remarks: remarks.trim(),
        needs_review: !ts || !Number.isFinite(amount), deleted: false,
      });
    }
  } catch { /* income tab optional */ }

  return { transactions, income, source: txFetched.source };
}

export function getLastSync() {
  const r = getDb().prepare("SELECT value FROM settings WHERE key='last_sync'").get();
  return r ? r.value : null;
}
