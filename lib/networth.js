import { getDb } from './db.js';
import { statementView } from './cycles.js';
import { accountBalances } from './balances.js';
import { creditLedger } from './credit.js';
import { listHoldings } from './holdings.js';
import { listDebts, debtsOutstandingAt } from './debts.js';

// ---------------------------------------------------------------------------
// Net worth (new feature).
//
//   Net worth = bank balances
//             + savings + investments (current value)
//             + outstanding credit given (money owed back to you)
//             − credit-card live debt
//             − outstanding credit taken (money you owe other people)
//
// The current snapshot uses the accurate per-module numbers (Balances, Credit
// ledger, Holdings). The monthly TREND is reconstructed from transaction/income
// history at each month-end; savings/investment holdings have no history, so
// they are carried flat at today's value (documented, not hidden).
// ---------------------------------------------------------------------------

const r2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

export function netWorthSnapshot(db = getDb(), now = new Date()) {
  const bal = accountBalances(db);
  const holdings = listHoldings(db).totals;
  const credit = creditLedger(db).totals;
  const sv = statementView(now);
  const cardDebt = sv.totals.totalDebtLive;

  const assets = {
    bank: bal.totalBankBalance,
    savings: holdings.savings || 0,
    investments: holdings.investment || 0,
    creditGivenOutstanding: credit.outstanding,
  };
  const liabilities = {
    cardDebt: r2(cardDebt),
    creditTakenOutstanding: listDebts(db).totals.outstanding,
  };
  const totalAssets = r2(
    assets.bank + assets.savings + assets.investments + assets.creditGivenOutstanding
  );
  const totalLiabilities = r2(liabilities.cardDebt + liabilities.creditTakenOutstanding);
  const netWorth = r2(totalAssets - totalLiabilities);

  return { assets, liabilities, totalAssets, totalLiabilities, netWorth };
}

/** Monthly net-worth trend (approximate — see module header). */
export function netWorthTrend(db = getDb(), now = new Date()) {
  const accounts = db.prepare('SELECT name, opening_balance FROM accounts WHERE active=1').all();
  const openingSum = accounts.reduce((a, x) => a + x.opening_balance, 0);
  const accountNames = accounts.map((a) => a.name);
  const holdingsFlat = listHoldings(db).totals.currentValue || 0;

  // Bounds: from first transaction month to current month.
  const first = db
    .prepare('SELECT MIN(ts) m FROM transactions WHERE deleted=0 AND ts IS NOT NULL')
    .get().m;
  if (!first) return { points: [], holdingsFlat };
  const start = new Date(`${first.slice(0, 7)}-01T00:00:00`);

  const inList = accountNames.length ? `(${accountNames.map(() => '?').join(',')})` : '(NULL)';
  const incomeToEnd = db.prepare(
    `SELECT COALESCE(SUM(amount),0) s FROM income
     WHERE deleted=0 AND amount IS NOT NULL AND account IN ${inList} AND ts<=?`
  );
  const outflowToEnd = db.prepare(
    `SELECT COALESCE(SUM(amount),0) s FROM transactions
     WHERE deleted=0 AND amount IS NOT NULL AND method IN ${inList} AND ts<=?`
  );
  const cardDebtToEnd = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN card_direction='debt+' THEN amount
                              WHEN card_direction='debt-' THEN -amount ELSE 0 END),0) s
     FROM transactions WHERE deleted=0 AND amount IS NOT NULL AND card_affected IS NOT NULL AND ts<=?`
  );
  const givenToEnd = db.prepare(
    `SELECT COALESCE(SUM(amount),0) s FROM transactions
     WHERE deleted=0 AND amount IS NOT NULL AND category='Credit Given' AND ts<=?`
  );
  const returnsToEnd = db.prepare(
    `SELECT COALESCE(SUM(amount),0) s FROM income
     WHERE deleted=0 AND amount IS NOT NULL AND source='Credit Return' AND ts<=?`
  );

  const points = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  const endY = now.getFullYear();
  const endM = now.getMonth();
  while (y < endY || (y === endY && m <= endM)) {
    const lastDay = new Date(y, m + 1, 0).getDate();
    const isCurrent = y === endY && m === endM;
    const boundary = isCurrent ? now : new Date(y, m, lastDay, 23, 59, 59);
    const endIso = `${boundary.getFullYear()}-${pad(boundary.getMonth() + 1)}-${pad(boundary.getDate())}T23:59:59`;

    const bank =
      openingSum +
      incomeToEnd.get(...accountNames, endIso).s -
      outflowToEnd.get(...accountNames, endIso).s;
    const cardDebt = cardDebtToEnd.get(endIso).s;
    const creditOut = Math.max(0, givenToEnd.get(endIso).s - returnsToEnd.get(endIso).s);
    // Borrowed money is dated (borrowed_on / paid_on), so unlike holdings it can
    // be reconstructed properly rather than carried flat.
    const debtTaken = debtsOutstandingAt(db, endIso);
    const net = bank - cardDebt + creditOut + holdingsFlat - debtTaken;

    points.push({
      month: `${y}-${pad(m + 1)}`,
      bank: r2(bank),
      cardDebt: r2(cardDebt),
      creditTakenOutstanding: debtTaken,
      creditGivenOutstanding: r2(creditOut),
      holdings: r2(holdingsFlat),
      netWorth: r2(net),
    });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return { points, holdingsFlat: r2(holdingsFlat) };
}

export function netWorth(db = getDb(), now = new Date()) {
  return { snapshot: netWorthSnapshot(db, now), trend: netWorthTrend(db, now).points };
}
