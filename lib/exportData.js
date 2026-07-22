import { getDb } from './db.js';

// ---------------------------------------------------------------------------
// Data export / backup.
//   - JSON: a full snapshot of every table (a portable backup).
//   - CSV : one table at a time, for spreadsheets.
// The Google Sheet remains the source of truth; this is a convenience backup
// of the app's derived + manual data (verify flags, settings, holdings, etc.).
// ---------------------------------------------------------------------------

const TABLES = [
  'transactions',
  'annotations',
  'cards',
  'income',
  'accounts',
  'credit_status',
  'settings',
  'holdings',
  'invoices',
  'debts',
  'debt_payments',
  'events',
];

export function exportJson(db = getDb()) {
  const out = { exportedAt: new Date().toISOString(), version: 1, tables: {} };
  for (const t of TABLES) {
    try {
      out.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
    } catch {
      out.tables[t] = [];
    }
  }
  out.counts = Object.fromEntries(Object.entries(out.tables).map(([k, v]) => [k, v.length]));
  return out;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(table, db = getDb()) {
  if (!TABLES.includes(table)) throw new Error(`Unknown table: ${table}`);
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return lines.join('\n');
}

export const EXPORT_TABLES = TABLES;
