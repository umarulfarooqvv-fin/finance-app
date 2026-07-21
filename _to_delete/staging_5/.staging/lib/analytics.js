import { getDb } from './db.js';

// ---------------------------------------------------------------------------
// Detailed Expenses analytics (replicates the "Detailed Expenses" tab)
// ---------------------------------------------------------------------------
// Display categories = form categories plus derived ones the sheet shows:
//   - "Credit Card"   → payments TO cards (kind = card_payment)
//   - "Credit Return" → card payments whose remarks reference credit-given money
//   - "Medicine" / "Groceries" → keyword-derived from remarks (display-only)
// Future-dated rows (pre-logged EMIs) are excluded from every series.

export const DISPLAY_CATEGORIES = [
  'Family', 'Food', 'Personal', 'Entertainment', 'Fuel', 'Medicine', 'Groceries',
  'Credit Card', 'Credit Return', 'Surcharge', 'Taxes', 'Maintenance',
  'Gifts/Donations', 'Credit Given',
];

export function displayCategory(tx) {
  if (tx.kind === 'card_payment') {
    return /credit\s*g[io]ven/i.test(tx.remarks || '') ? 'Credit Return' : 'Credit Card';
  }
  const r = (tx.remarks || '').toLowerCase();
  if (tx.category !== 'Credit Given') {
    if (/medicin|medicine|tablet/.test(r)) return 'Medicine';
    if (/grocer/.test(r)) return 'Groceries';
  }
  return tx.category;
}

function rows(db, fromIso, toIso) {
  return db.prepare(`
    SELECT * FROM transactions
    WHERE deleted=0 AND amount IS NOT NULL AND ts IS NOT NULL AND ts>=? AND ts<=?
    ORDER BY ts ASC
  `).all(fromIso, toIso);
}

const r2 = (n) => Math.round(n * 100) / 100;
const dayMs = 86400000;

function isoDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function categoryBreakdown(db, fromIso, toIso, opts = {}) {
  const list = rows(db, fromIso, toIso).filter((t) => keep(t, opts));
  const byCat = {};
  let total = 0;
  for (const t of list) {
    const c = displayCategory(t);
    byCat[c] = (byCat[c] || 0) + t.amount;
    total += t.amount;
  }
  const breakdown = DISPLAY_CATEGORIES.map((c) => ({
    category: c,
    total: r2(byCat[c] || 0),
    share: total > 0 ? (byCat[c] || 0) / total : 0,
  }));
  return { total: r2(total), breakdown, count: list.length };
}

function keep(t, { excludeCategories = [], excludeMethods = [] }) {
  return !excludeCategories.includes(displayCategory(t)) && !excludeMethods.includes(t.method);
}

/**
 * Full Detailed Expenses payload.
 * from/to: 'YYYY-MM-DD'. Comparison windows: same length ending 1 month earlier,
 * and the identical dates 1 year earlier (matches the sheet's two comparisons).
 */
export function detailedExpenses({ from, to, excludeCategories = [], excludeMethods = [] }) {
  const db = getDb();
  const now = new Date();
  const opts = { excludeCategories, excludeMethods };

  const fromD = new Date(`${from}T00:00:00`);
  const toD = new Date(`${to}T23:59:59`);
  const days = Math.max(1, Math.round((toD - fromD) / dayMs));

  const span = (d1, d2) => [`${isoDate(d1)}T00:00:00`, `${isoDate(d2)}T23:59:59`];

  const [aFrom, aTo] = span(fromD, toD);
  const monthAgo = span(new Date(fromD.getFullYear(), fromD.getMonth() - 1, fromD.getDate()),
                        new Date(toD.getFullYear(), toD.getMonth() - 1, toD.getDate()));
  const yearAgo = span(new Date(fromD.getFullYear() - 1, fromD.getMonth(), fromD.getDate()),
                       new Date(toD.getFullYear() - 1, toD.getMonth(), toD.getDate()));

  const current = categoryBreakdown(db, aFrom, aTo, opts);
  const prevMonth = categoryBreakdown(db, monthAgo[0], monthAgo[1], opts);
  const prevYear = categoryBreakdown(db, yearAgo[0], yearAgo[1], opts);

  // Comparison rows: share now vs then + absolute delta (sheet's Comparison block)
  const comparison = DISPLAY_CATEGORIES.map((c) => {
    const cur = current.breakdown.find((b) => b.category === c);
    const pm = prevMonth.breakdown.find((b) => b.category === c);
    const py = prevYear.breakdown.find((b) => b.category === c);
    return {
      category: c,
      current: cur.total, currentShare: cur.share,
      prevMonth: pm.total, prevMonthShare: pm.share, deltaMonth: r2(cur.total - pm.total),
      prevYear: py.total, prevYearShare: py.share, deltaYear: r2(cur.total - py.total),
    };
  });

  // Daily series within range (with running cumulative). Like the sheet, the
  // selected range includes pre-logged future rows that fall inside it.
  const inRange = rows(db, aFrom, aTo).filter((t) => keep(t, opts));
  const dailyMap = new Map();
  for (const t of inRange) {
    const d = t.ts.slice(0, 10);
    dailyMap.set(d, (dailyMap.get(d) || 0) + t.amount);
  }
  let cum = 0;
  const daily = [...dailyMap.entries()].sort().map(([date, total]) => {
    cum += total;
    return { date, total: r2(total), cumulative: r2(cum) };
  });

  // Monthly series across ALL data, including future months — the sheet shows
  // pre-logged EMI installments as projection months (e.g. Jul-2026 → Feb-2027).
  const all = rows(db, '0000', '9999').filter((t) => keep(t, opts));
  const monthlyMap = new Map();
  for (const t of all) {
    const m = t.ts.slice(0, 7); // YYYY-MM
    if (!monthlyMap.has(m)) monthlyMap.set(m, { total: 0, byCat: {} });
    const e = monthlyMap.get(m);
    e.total += t.amount;
    const c = displayCategory(t);
    e.byCat[c] = (e.byCat[c] || 0) + t.amount;
  }
  let mCum = 0, prevTotal = null;
  const monthly = [...monthlyMap.entries()].sort().map(([month, e]) => {
    mCum += e.total;
    const row = {
      month,
      total: r2(e.total),
      delta: prevTotal === null ? null : r2(e.total - prevTotal),
      cumulative: r2(mCum),
      byCat: Object.fromEntries(Object.entries(e.byCat).map(([k, v]) => [k, r2(v)])),
    };
    prevTotal = e.total;
    return row;
  });

  // Transactions grouped by display category (sheet's detail list)
  const groups = DISPLAY_CATEGORIES.map((c) => ({
    category: c,
    transactions: inRange
      .filter((t) => displayCategory(t) === c)
      .map((t) => ({ id: t.id, date: t.ts.slice(0, 10), amount: t.amount, method: t.method, category: t.category, remarks: t.remarks })),
  })).filter((g) => g.transactions.length > 0);

  return {
    range: { from, to, days, daysTillToday: Math.max(0, Math.round((now - fromD) / dayMs)) },
    current, prevMonth: { ...prevMonth, window: monthAgo }, prevYear: { ...prevYear, window: yearAgo },
    comparison, daily, monthly, groups,
  };
}
