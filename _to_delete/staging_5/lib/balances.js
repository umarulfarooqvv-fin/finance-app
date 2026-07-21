import { getDb } from './db.js';
import { statementView } from './cycles.js';

// ---------------------------------------------------------------------------
// Per-account balances:
//   balance = opening_balance
//           + income received into the account     (Form Responses 2)
//           − spends paid from the account         (method = account)
//           − card bills paid from the account     (card payments, method = account)
// A "balance since" date (settings) lets Farooq start counting from the day
// he began full tracking; opening_balance is the real balance on that day.
// Future-dated rows never count. 'None'-account income is reported separately.
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const isoNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59:59`;
};

export function getBalanceSince(db = getDb()) {
  const r = db.prepare("SELECT value FROM settings WHERE key='balance_since'").get();
  return r ? r.value : null; // YYYY-MM-DD or null = all history
}

export function setBalanceSince(date, db = getDb()) {
  if (date) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('balance_since', ?)").run(date);
  else db.prepare("DELETE FROM settings WHERE key='balance_since'").run();
}

export function accountBalances(db = getDb()) {
  const since = getBalanceSince(db);
  const from = since ? `${since}T00:00:00` : '0000';
  const to = isoNow();
  const accounts = db.prepare('SELECT * FROM accounts WHERE active=1 ORDER BY name').all();

  const incomeSum = db.prepare(`
    SELECT COALESCE(SUM(amount),0) s FROM income
    WHERE deleted=0 AND amount IS NOT NULL AND account=? AND ts>=? AND ts<=?`);
  const outSum = db.prepare(`
    SELECT COALESCE(SUM(amount),0) s FROM transactions
    WHERE deleted=0 AND amount IS NOT NULL AND method=? AND ts>=? AND ts<=?`);

  const rows = accounts.map((a) => {
    const income = incomeSum.get(a.name, from, to).s;
    const outflow = outSum.get(a.name, from, to).s; // spends + card payments + credit given via this account
    return {
      account: a.name,
      color: a.color,
      opening: a.opening_balance,
      income: r2(income),
      outflow: r2(outflow),
      balance: r2(a.opening_balance + income - outflow),
    };
  });

  const unassigned = db.prepare(`
    SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM income
    WHERE deleted=0 AND amount IS NOT NULL AND (account='None' OR account='') AND ts>=? AND ts<=?
  `).get(from, to);

  // Cards: available to spend = limit − live debt (negative debt adds headroom)
  const sv = statementView();
  const cards = sv.rows.map((r) => ({
    card: r.card,
    color: r.color,
    liveDebt: r.totalDebtLive,
    creditLimit: r.creditLimit || null,
    available: r.creditLimit ? r2(r.creditLimit - r.totalDebtLive) : null,
  }));

  return {
    since,
    accounts: rows,
    totalBankBalance: r2(rows.reduce((a, r) => a + r.balance, 0)),
    unassignedIncome: { total: r2(unassigned.s), count: unassigned.c },
    cards,
    totalAvailableCredit: r2(cards.reduce((a, c) => a + (c.available || 0), 0)),
  };
}

export function setOpeningBalance(name, opening, db = getDb()) {
  db.prepare('UPDATE accounts SET opening_balance=? WHERE name=?').run(opening, name);
}

function r2(n) { return Math.round(n * 100) / 100; }
