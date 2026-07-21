import { getDb } from './db.js';
import { statementView } from './cycles.js';
import { displayCategory } from './analytics.js';
import { getDefs, defStatus } from './recurring.js';

// ---------------------------------------------------------------------------
// Spend forecasting + Recommended Bank Reserve (spec §3.5)
//
//   Estimated Spend Remaining This Month =
//     avgDailySpend(month-to-date) × daysRemaining
//   broken down by card and by category, with an optional overlay of known
//   recurring items (EMIs/subscriptions) whose occurrence falls in the
//   remaining days of the month but hasn't been posted yet.
//
//   Recommended Bank Reserve = Total Debt (Live) + Estimated Spend Remaining
//   "Keep at least ₹X in the bank to cover all card dues + projected spend."
// ---------------------------------------------------------------------------

const r2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * @param opts.method            'runrate' | 'runrate+recurring'  (default runrate+recurring)
 * @param opts.excludeCreditGiven  exclude 'Credit Given' rows from the run-rate (default true)
 */
export function forecast(opts = {}, db = getDb(), now = new Date()) {
  const { method = 'runrate+recurring', excludeCreditGiven = true } = opts;
  const y = now.getFullYear();
  const mo = now.getMonth();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const today = now.getDate();
  const elapsedDays = Math.max(1, today);
  const daysRemaining = Math.max(0, daysInMonth - today);

  const monthPrefix = `${y}-${pad(mo + 1)}`;
  const startIso = `${monthPrefix}-01T00:00:00`;
  const nowIso = `${isoDate(now)}T23:59:59`;

  // Month-to-date spends: exclude card payments (transfers), blanks, future rows.
  const rows = db
    .prepare(
      `SELECT ts, amount, method, category, remarks, kind, card_affected FROM transactions
       WHERE deleted=0 AND amount IS NOT NULL AND ts>=? AND ts<=?
         AND kind NOT IN ('card_payment','investment')`
    )
    .all(startIso, nowIso)
    .filter((t) => !(excludeCreditGiven && t.category === 'Credit Given'));

  let mtdTotal = 0;
  const byCatMtd = {};
  const byCardMtd = {};
  for (const t of rows) {
    mtdTotal += t.amount;
    const c = displayCategory(t);
    byCatMtd[c] = (byCatMtd[c] || 0) + t.amount;
    if (t.card_affected) byCardMtd[t.card_affected] = (byCardMtd[t.card_affected] || 0) + t.amount;
  }

  const dailyRate = mtdTotal / elapsedDays;
  const project = (subtotal) => (subtotal / elapsedDays) * daysRemaining;

  const byCategory = Object.entries(byCatMtd)
    .map(([category, mtd]) => ({ category, mtd: r2(mtd), projected: r2(project(mtd)) }))
    .sort((a, b) => b.projected - a.projected);
  const byCard = Object.entries(byCardMtd)
    .map(([card, mtd]) => ({ card, mtd: r2(mtd), projected: r2(project(mtd)) }))
    .sort((a, b) => b.projected - a.projected);

  let runRateForecast = project(mtdTotal);

  // Recurring overlay: definitions whose next occurrence is dated in the
  // remaining part of this month and isn't posted yet. Adds a known, non-average
  // component (EMIs don't follow the daily run-rate).
  const recurring = [];
  if (method === 'runrate+recurring') {
    const todayIso = isoDate(now);
    const monthEndIso = `${monthPrefix}-${pad(daysInMonth)}`;
    for (const def of getDefs(db)) {
      const st = defStatus(def, db, now);
      for (const occ of st.occurrences) {
        if (occ.status === 'upcoming' && occ.date > todayIso && occ.date <= monthEndIso) {
          recurring.push({ name: def.name, date: occ.date, amount: def.amount, method: def.method });
        }
      }
    }
  }
  const recurringTotal = recurring.reduce((a, x) => a + (x.amount || 0), 0);

  const estimatedRemaining = r2(runRateForecast + recurringTotal);

  const sv = statementView(now);
  const totalDebtLive = sv.totals.totalDebtLive;
  const reserve = r2(totalDebtLive + estimatedRemaining);

  return {
    method,
    period: { from: `${monthPrefix}-01`, to: isoDate(now), monthEnd: `${monthPrefix}-${pad(daysInMonth)}` },
    daysInMonth,
    daysElapsed: elapsedDays,
    daysRemaining,
    monthToDate: r2(mtdTotal),
    dailyRunRate: r2(dailyRate),
    runRateForecast: r2(runRateForecast),
    recurring,
    recurringTotal: r2(recurringTotal),
    estimatedRemaining,
    byCategory,
    byCard,
    totalDebtLive,
    recommendedReserve: reserve,
  };
}
