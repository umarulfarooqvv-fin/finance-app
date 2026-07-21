import { getDb } from './db.js';

// ---------------------------------------------------------------------------
// Global search across transactions, income, credit-given, EMIs, invoices,
// and holdings. Case-insensitive substring match on the most useful fields.
// Returns capped, categorized results for a command-palette style UI.
// ---------------------------------------------------------------------------

const LIMIT = 40;

export function searchAll(query, db = getDb()) {
  const q = String(query || '').trim();
  if (!q) return { query: '', groups: [], total: 0 };
  const like = `%${q}%`;

  const tx = db
    .prepare(
      `SELECT id, ts, amount, method, category, remarks FROM transactions
       WHERE deleted=0 AND (remarks LIKE ? COLLATE NOCASE OR category LIKE ? COLLATE NOCASE OR method LIKE ? COLLATE NOCASE)
       ORDER BY ts DESC LIMIT ?`
    )
    .all(like, like, like, LIMIT)
    .map((r) => ({ id: r.id, date: r.ts ? r.ts.slice(0, 10) : null, amount: r.amount, method: r.method, category: r.category, remarks: r.remarks }));

  const income = db
    .prepare(
      `SELECT id, ts, amount, source, account, remarks FROM income
       WHERE deleted=0 AND (remarks LIKE ? COLLATE NOCASE OR source LIKE ? COLLATE NOCASE OR account LIKE ? COLLATE NOCASE)
       ORDER BY ts DESC LIMIT ?`
    )
    .all(like, like, like, LIMIT)
    .map((r) => ({ id: r.id, date: r.ts ? r.ts.slice(0, 10) : null, amount: r.amount, source: r.source, account: r.account, remarks: r.remarks }));

  const invoices = db
    .prepare(
      `SELECT id, client, number, amount, status FROM invoices
       WHERE client LIKE ? COLLATE NOCASE OR number LIKE ? COLLATE NOCASE OR note LIKE ? COLLATE NOCASE
       LIMIT ?`
    )
    .all(like, like, like, LIMIT);

  const holdings = db
    .prepare(
      `SELECT id, kind, name, institution, current_value FROM holdings
       WHERE active=1 AND (name LIKE ? COLLATE NOCASE OR institution LIKE ? COLLATE NOCASE OR note LIKE ? COLLATE NOCASE)
       LIMIT ?`
    )
    .all(like, like, like, LIMIT);

  const groups = [
    { type: 'transactions', label: 'Transactions', items: tx },
    { type: 'income', label: 'Income', items: income },
    { type: 'invoices', label: 'Invoices', items: invoices },
    { type: 'holdings', label: 'Savings & Investments', items: holdings },
  ].filter((g) => g.items.length > 0);

  const total = groups.reduce((a, g) => a + g.items.length, 0);
  return { query: q, groups, total };
}
