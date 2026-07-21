// ---------------------------------------------------------------------------
// App persistence layer — now backed by Supabase (Postgres) via lib/store.js.
// The exported surface is unchanged from the old Google-Sheets/Apps-Script
// version, so every module that imports from here (bootstrap, recurring,
// credit, budgets, holdings, the API routes) works without modification:
//
//   writesEnabled()          → is the store configured
//   getConfig / setConfig    → JSON config in app_config (cards, budgets, …)
//   getMeta / setMeta        → verified flags on transactions
//   appendRow / updateRow    → insert / update a transaction (or income) row
// ---------------------------------------------------------------------------

import { storeEnabled, select, insert, update, getConfigValue, setConfigValue } from './store.js';
import { normalizeEntry, parseTimestamp, localIso, istIso } from './parser.js';

export function writesEnabled() {
  return storeEnabled();
}

// ---- key/value config ------------------------------------------------------

export async function getConfig(key) {
  const value = await getConfigValue(key);
  return value == null ? null : { key, value };
}

export async function setConfig(key, value) {
  return setConfigValue(key, value);
}

// ---- verified flags (stored directly on the transaction row) ---------------

export async function getMeta() {
  const rows = await select('transactions', { filters: { verified: 'eq.true' }, select: 'id,verified' });
  return { meta: (rows || []).map((r) => ({ txId: r.id, verified: r.verified })) };
}

export async function setMeta({ txId, verified }) {
  await update('transactions', { id: `eq.${txId}` }, { verified: Boolean(verified) });
  return { ok: true };
}

// ---- row writes ------------------------------------------------------------

const INCOME_TAB = process.env.DAILY_INCOME_TAB || 'Form Responses 2';

function dateFrom(timestamp) {
  if (timestamp) {
    const p = parseTimestamp(timestamp);
    if (p) return p.date;
  }
  return null; // → normalizeEntry uses IST "now"
}

/**
 * Append a transaction (or an income row when tab is the income tab). Keeps the
 * signature the app already calls; returns { row: id } like before.
 */
export async function appendRow({ tab, timestamp, amount, method, category, remarks, source, account }) {
  const date = dateFrom(timestamp);
  if (tab && tab === INCOME_TAB) {
    const id = 'inc-' + Math.random().toString(16).slice(2, 12);
    const amt = amount === '' || amount == null ? null : parseFloat(String(amount).replace(/,/g, ''));
    const rows = await insert(
      'income',
      [{ id, ts: date ? localIso(date) : istIso(), amount: Number.isFinite(amt) ? amt : null,
         source: source || category || '', account: account || '', remarks: (remarks || '').trim(),
         needs_review: !Number.isFinite(amt), deleted: false }],
      { upsert: true }
    );
    return { row: (rows && rows[0] && rows[0].id) || id };
  }
  const rec = normalizeEntry({ amount, method, category, remarks, date }, { source: source || 'app' });
  const rows = await insert('transactions', [{ ...rec, verified: false, deleted: false }], { upsert: true });
  return { row: (rows && rows[0] && rows[0].id) || rec.id };
}

/** Update an existing transaction by id (the `row` param is the tx id). */
export async function updateRow({ row, timestamp, amount, method, category, remarks }) {
  const date = dateFrom(timestamp);
  const rec = normalizeEntry({ amount, method, category, remarks, date }, { id: row, deterministic: true });
  const { id, source, ...patch } = rec;
  await update('transactions', { id: `eq.${row}` }, { ...patch, deleted: false });
  return { ok: true, row };
}

export async function ping() {
  await select('app_state', { filters: { key: 'eq.version' }, select: 'value' });
  return { ok: true };
}
