import { getDb } from './db.js';
import { writesEnabled, getConfig, setConfig } from './sheets.js';
import { displayCategory } from './analytics.js';

// ---------------------------------------------------------------------------
// Category budgets (new feature).
//
// A budget is a monthly cap per display-category. Definitions live in settings
// ('category_budgets') and are mirrored to the sheet's AppConfig ('budgets') so
// they survive serverless cold starts, exactly like recurring defs and card
// config. The overview compares this month's spend (excluding card payments and
// future-dated rows) against each cap and flags near/over budgets, which the
// daily alert cron can push.
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'category_budgets';
const WARN_AT = 0.8; // fraction of budget that counts as "near"
const r2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

export function getBudgets(db = getDb()) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(SETTINGS_KEY);
  try {
    return r ? JSON.parse(r.value) : {}; // { [category]: monthlyAmount }
  } catch {
    return {};
  }
}

export async function saveBudgets(budgets, db = getDb()) {
  const clean = {};
  for (const [cat, amt] of Object.entries(budgets || {})) {
    const n = Number(amt);
    if (Number.isFinite(n) && n > 0) clean[cat] = r2(n);
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(
    SETTINGS_KEY,
    JSON.stringify(clean)
  );
  if (writesEnabled()) await setConfig('budgets', JSON.stringify(clean)).catch(() => {});
  return clean;
}

/** Cold-start hydration from the sheet's AppConfig. */
export async function loadBudgetsFromSheet(db = getDb()) {
  const r = await getConfig('budgets');
  if (!r || !r.value) return 0;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(SETTINGS_KEY, r.value);
  return Object.keys(JSON.parse(r.value)).length;
}

/** This month's spend per display-category (excludes card payments + future rows). */
export function monthSpendByCategory(db = getDb(), now = new Date()) {
  const prefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const startIso = `${prefix}-01T00:00:00`;
  const nowIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:59:59`;
  const rows = db
    .prepare(
      `SELECT amount, category, remarks, kind FROM transactions
       WHERE deleted=0 AND amount IS NOT NULL AND ts>=? AND ts<=? AND kind NOT IN ('card_payment','investment')`
    )
    .all(startIso, nowIso);
  const byCat = {};
  for (const t of rows) {
    const c = displayCategory(t);
    byCat[c] = (byCat[c] || 0) + t.amount;
  }
  return byCat;
}

export function budgetOverview(db = getDb(), now = new Date()) {
  const budgets = getBudgets(db);
  const spend = monthSpendByCategory(db, now);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const today = now.getDate();
  const monthFraction = today / daysInMonth;

  const items = Object.entries(budgets)
    .map(([category, budget]) => {
      const spent = r2(spend[category] || 0);
      const ratio = budget > 0 ? spent / budget : 0;
      // pace = where you "should" be if spending evenly across the month
      const paceTarget = r2(budget * monthFraction);
      let status = 'ok';
      if (ratio >= 1) status = 'over';
      else if (ratio >= WARN_AT) status = 'warn';
      else if (spent > paceTarget) status = 'ahead';
      return {
        category,
        budget: r2(budget),
        spent,
        remaining: r2(budget - spent),
        ratio,
        paceTarget,
        status,
        projected: r2(today > 0 ? (spent / today) * daysInMonth : 0),
      };
    })
    .sort((a, b) => b.ratio - a.ratio);

  const totalBudget = r2(items.reduce((a, i) => a + i.budget, 0));
  const totalSpent = r2(items.reduce((a, i) => a + i.spent, 0));
  return {
    items,
    totals: {
      budget: totalBudget,
      spent: totalSpent,
      remaining: r2(totalBudget - totalSpent),
      overCount: items.filter((i) => i.status === 'over').length,
      warnCount: items.filter((i) => i.status === 'warn').length,
    },
    // Unbudgeted categories with spend this month — candidates to add a budget for
    unbudgeted: Object.entries(spend)
      .filter(([c]) => !(c in budgets))
      .map(([category, spent]) => ({ category, spent: r2(spent) }))
      .sort((a, b) => b.spent - a.spent),
  };
}

/** Alert lines for the daily cron: categories over or near their budget. */
export function budgetAlerts(db = getDb(), now = new Date()) {
  const { items } = budgetOverview(db, now);
  return items
    .filter((i) => i.status === 'over' || i.status === 'warn')
    .map((i) =>
      i.status === 'over'
        ? `🔴 ${i.category} over budget: ₹${i.spent} / ₹${i.budget}`
        : `⚠ ${i.category} near budget: ₹${i.spent} / ₹${i.budget}`
    );
}
