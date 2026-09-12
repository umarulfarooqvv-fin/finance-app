import assert from 'node:assert/strict';
import { test } from 'vitest';
import { accountBalances, netWorth } from '@/lib/balances';
import { creditLedger } from '@/lib/credit';
import { emiPlans, emiSummary } from '@/lib/emi';
import { forecast } from '@/lib/forecast';
import { incomeBetween, isSpend, monthSummary, priorWindow, spendBetween, total } from '@/lib/analytics';
import { statementView } from '@/lib/statement';
import { round2 } from '@/lib/money';
import type { Account, Card } from '@/lib/types';
import { income, makeSnapshot, tx } from './helpers.ts';

/* ===========================================================================
   Financial calculations.

   Each figure here is one a person would check by hand and complain about if
   it were wrong. The tests are written as worked examples with the arithmetic
   spelled out, so a failure says which sum broke rather than only that a
   number moved.
   =========================================================================== */

const coral: Card = {
  name: 'Coral', billDate: 25, graceDays: 17, dueDay: 12, dueCycle: 'next',
  creditLimit: 50000, openingBalance: 0, openingDate: null, slot: 4, active: true,
  statementBoundary: 'inclusive',
};

/* --- What counts as spend ------------------------------------------------ */

test('spend excludes bill payments, lending and transfers', () => {
  // The definition that makes or breaks every total in the app: a month with
  // three bill payments must not read as a spending disaster.
  const rows = [
    tx({ kind: 'spend', amount: 500 }),
    tx({ kind: 'card_payment', amount: 9000 }),   // settling debt already counted
    tx({ kind: 'credit_given', amount: 2000 }),   // an outflow, but not consumption
    tx({ kind: 'investment', amount: 5000 }),     // still your money
    tx({ kind: 'unknown', amount: 700 }),         // unclassified, never counted
  ];
  const snap = makeSnapshot({ transactions: rows });

  assert.equal(rows.filter(isSpend).length, 1);
  assert.equal(total(spendBetween(snap, '2000-01-01', '2030-01-01')), 500);
});

test('deleted rows stop counting immediately', () => {
  const snap = makeSnapshot({
    transactions: [
      tx({ amount: 300, ts: '2026-06-01T10:00:00' }),
      tx({ amount: 700, ts: '2026-06-02T10:00:00', deleted: true }),
    ],
  });
  assert.equal(total(spendBetween(snap, '2026-06-01', '2026-06-30')), 300);
});

test('a row with no amount is skipped, not treated as zero', () => {
  const snap = makeSnapshot({
    transactions: [tx({ amount: 100 }), tx({ amount: null })],
  });
  const rows = spendBetween(snap, '2000-01-01', '2030-01-01');
  assert.equal(rows.length, 1, 'an unpriced row cannot contribute to a total');
  assert.equal(total(rows), 100);
});

/* --- Income vs expense --------------------------------------------------- */

test('income and spend are counted separately and net correctly', () => {
  const snap = makeSnapshot({
    transactions: [
      tx({ ts: '2026-06-03T10:00:00', amount: 1200 }),
      tx({ ts: '2026-06-08T10:00:00', amount: 800 }),
    ],
    income: [
      income({ ts: '2026-06-01T10:00:00', amount: 50000, source: 'Salary' }),
      income({ ts: '2026-06-05T10:00:00', amount: 5000, source: 'Freelance' }),
    ],
  });

  const m = monthSummary(snap, '2026-06-10');
  assert.equal(m.spend, 2000);
  assert.equal(m.income, 55000);
  assert.equal(m.net, 53000, 'net is income minus spend');
});

test('income outside the window is excluded from the window', () => {
  const snap = makeSnapshot({
    income: [
      income({ ts: '2026-05-31T23:59:59', amount: 100 }),
      income({ ts: '2026-06-01T00:00:00', amount: 200 }),
      income({ ts: '2026-06-30T23:59:59', amount: 400 }),
      income({ ts: '2026-07-01T00:00:00', amount: 800 }),
    ],
  });
  // Boundaries are inclusive at both ends of the day.
  assert.equal(incomeBetween(snap, '2026-06-01', '2026-06-30'), 600);
});

test('the prior-month comparison uses the same number of days', () => {
  // Comparing 10 elapsed days against a full previous month would show a fall
  // in spending every single month.
  const snap = makeSnapshot({
    transactions: [
      tx({ ts: '2026-06-05T10:00:00', amount: 500 }),   // this month, day 5
      tx({ ts: '2026-05-05T10:00:00', amount: 300 }),   // last month, day 5
      tx({ ts: '2026-05-25T10:00:00', amount: 9999 }),  // last month, day 25 — out of window
    ],
  });
  const prior = priorWindow(snap, '2026-06-10');
  assert.equal(prior.from, '2026-05-01');
  assert.equal(prior.to, '2026-05-10');
  assert.equal(prior.spend, 300, 'only the same elapsed window counts');
});

/* --- Statement ----------------------------------------------------------- */

test('worked example: a full cycle with a part payment', () => {
  //   opening        0.00
  // + billed     2,500.00   (inside 26 Apr - 25 May)
  // - paid       1,000.00   (after the statement)
  // = due        1,500.00
  // + unbilled     400.00   (after the statement)
  // = balance    1,900.00
  const snap = makeSnapshot({
    cards: [coral],
    transactions: [
      tx({ ts: '2026-05-10T10:00:00', amount: 2500, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      tx({ ts: '2026-06-02T10:00:00', amount: 400, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      tx({ ts: '2026-06-03T10:00:00', amount: 1000, method: 'Fi', category: 'Coral', kind: 'card_payment', cardAffected: 'Coral', cardDirection: 'debt-' }),
    ],
  });
  const r = statementView(snap, '2026-06-10').rows[0]!;
  assert.equal(r.remainingDueBill, 1500);
  assert.equal(r.unbilled, 400);
  assert.equal(r.totalDebtLive, 1900);
  assert.equal(r.remainingDueBill + r.unbilled, r.totalDebtLive);
});

test('utilisation is debt over limit, and absent without a limit', () => {
  const snap = makeSnapshot({
    cards: [coral],
    transactions: [tx({ ts: '2026-05-10T10:00:00', amount: 5000, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' })],
  });
  assert.equal(statementView(snap, '2026-06-10').rows[0]!.utilization, 0.1); // 5000 / 50000

  const noLimit = makeSnapshot({
    cards: [{ ...coral, creditLimit: 0 }],
    transactions: [tx({ ts: '2026-05-10T10:00:00', amount: 5000, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' })],
  });
  assert.equal(
    statementView(noLimit, '2026-06-10').rows[0]!.utilization,
    null,
    'a ratio with an unknown denominator must be absent, not zero',
  );
});

test('a payment cannot reduce a bill below zero', () => {
  const snap = makeSnapshot({
    cards: [coral],
    transactions: [
      tx({ ts: '2026-05-10T10:00:00', amount: 100, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      tx({ ts: '2026-06-01T10:00:00', amount: 500, method: 'Fi', category: 'Coral', kind: 'card_payment', cardAffected: 'Coral', cardDirection: 'debt-' }),
    ],
  });
  const r = statementView(snap, '2026-06-10').rows[0]!;
  assert.equal(r.remainingDueBill, 0, 'a bill is never negative');
  assert.equal(r.totalDebtLive, -400, 'but the balance shows the overpayment');
});

/* --- Forecast ------------------------------------------------------------ */

test('the forecast projects the run rate and never alters actuals', () => {
  // 10 days elapsed of June, ₹2,000 spent -> ₹200/day -> 20 days left = ₹4,000.
  const snap = makeSnapshot({
    cards: [],
    transactions: [
      tx({ ts: '2026-06-01T10:00:00', amount: 1000 }),
      tx({ ts: '2026-06-05T10:00:00', amount: 1000 }),
    ],
  });

  const before = total(spendBetween(snap, '2026-06-01', '2026-06-30'));
  const f = forecast(snap, '2026-06-10');

  assert.equal(f.spentSoFar, 2000);
  assert.equal(f.daysElapsed, 10);
  assert.equal(f.daysRemaining, 20);
  assert.equal(f.perDay, 200);
  assert.equal(f.projectedRemaining, 4000);
  assert.equal(f.projectedMonthTotal, 6000);

  // The projection must be derived, never written back.
  assert.equal(
    total(spendBetween(snap, '2026-06-01', '2026-06-30')),
    before,
    'forecasting must not modify actual financial data',
  );
  assert.equal(snap.transactions.length, 2);
});

test('known future rows are added to the projection, not averaged into it', () => {
  // A pre-logged EMI is a certainty on a date. Blending it into a run rate
  // would spread a known amount across days it does not fall on.
  const snap = makeSnapshot({
    cards: [],
    transactions: [
      tx({ ts: '2026-06-01T10:00:00', amount: 1000 }),
      tx({ ts: '2026-06-05T10:00:00', amount: 1000 }),
      tx({ ts: '2026-06-20T10:00:00', amount: 3000 }), // future, inside this month
    ],
  });
  const f = forecast(snap, '2026-06-10');
  assert.equal(f.spentSoFar, 2000, 'a future row is not spent yet');
  assert.equal(f.knownRemaining, 3000);
  assert.equal(f.projectedRemaining, 4000);
  assert.equal(f.estimatedRemaining, 7000, 'run rate plus the known amount');
});

test('the reserve is current debt plus what is still expected to be spent', () => {
  const snap = makeSnapshot({
    cards: [coral],
    transactions: [
      tx({ ts: '2026-05-10T10:00:00', amount: 2000, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      tx({ ts: '2026-06-01T10:00:00', amount: 1000 }),
    ],
  });
  const f = forecast(snap, '2026-06-10');
  assert.equal(f.totalDebtLive, 2000);
  assert.equal(
    f.recommendedReserve,
    round2(f.totalDebtLive + f.estimatedRemaining),
    'reserve = live debt + estimated remaining spend',
  );
});

/* --- Balances and net worth ---------------------------------------------- */

const fi: Account = { name: 'Fi', kind: 'bank', openingBalance: 10000, since: '2026-06-01', active: true };

test('an account balance is opening plus income minus outflows', () => {
  //  10,000 opening + 5,000 income - 1,200 spent - 800 bill payment = 13,000
  const snap = makeSnapshot({
    accounts: [fi],
    cards: [],
    transactions: [
      tx({ ts: '2026-06-03T10:00:00', amount: 1200, method: 'Fi' }),
      tx({ ts: '2026-06-04T10:00:00', amount: 800, method: 'Fi', category: 'Coral', kind: 'card_payment', cardAffected: 'Coral', cardDirection: 'debt-' }),
    ],
    income: [income({ ts: '2026-06-02T10:00:00', amount: 5000, account: 'Fi' })],
  });

  const [balance] = accountBalances(snap, '2026-06-10');
  assert.equal(balance!.incomeIn, 5000);
  assert.equal(balance!.paidOut, 2000, 'everything paid from the account leaves it, bills included');
  assert.equal(balance!.balance, 13000);
});

test('activity before the tracking date does not affect the balance', () => {
  const snap = makeSnapshot({
    accounts: [fi],
    cards: [],
    transactions: [tx({ ts: '2026-05-01T10:00:00', amount: 9999, method: 'Fi' })],
  });
  assert.equal(accountBalances(snap, '2026-06-10')[0]!.balance, 10000, 'the opening balance already accounts for it');
});

test('net worth is what you hold, plus what is owed to you, minus what you owe', () => {
  const snap = makeSnapshot({
    accounts: [fi],
    cards: [coral],
    transactions: [
      // 3,000 of card debt, of which 1,000 was lent out and not repaid.
      tx({ ts: '2026-06-02T10:00:00', amount: 2000, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      tx({ ts: '2026-06-03T10:00:00', amount: 1000, method: 'Coral', category: 'Credit Given', kind: 'credit_given', cardAffected: 'Coral', cardDirection: 'debt+', remarks: 'Fayiz', tags: { person: 'Fayiz' } }),
    ],
  });

  const nw = netWorth(snap, '2026-06-10');
  assert.equal(nw.liquid, 10000, 'nothing left the bank account');
  assert.equal(nw.owedToYou, 1000);
  assert.equal(nw.cardDebt, 3000);
  assert.equal(nw.net, round2(10000 + 1000 - 3000 - 0));
  assert.equal(nw.net, 8000);
});

/* --- Ledgers ------------------------------------------------------------- */

test('a partially repaid lending reports the remainder, not the whole', () => {
  const snap = makeSnapshot({
    transactions: [
      tx({ ts: '2026-01-01T10:00:00', amount: 5000, category: 'Credit Given', kind: 'credit_given', remarks: 'Fayiz', tags: { person: 'Fayiz' } }),
    ],
    income: [income({ ts: '2026-02-01T10:00:00', amount: 2000, source: 'Credit Return', remarks: 'Fayiz' })],
  });
  const l = creditLedger(snap);
  assert.equal(l.totalGiven, 5000);
  assert.equal(l.totalRepaid, 2000);
  assert.equal(l.totalOutstanding, 3000);
});

test('EMI instalments regroup into one plan with its progress', () => {
  // Three rows a month — principal, surcharge, tax — across two months.
  const rows = [1, 2].flatMap((n) => [
    tx({ ts: `2026-0${n}-11T10:00:00`, amount: 2000, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+', category: 'Personal', remarks: `Ipad Mini ${n}/24` }),
    tx({ ts: `2026-0${n}-11T10:00:00`, amount: 250, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+', category: 'Surcharge', remarks: `Ipad Mini ${n}/24 Charge` }),
    tx({ ts: `2026-0${n}-11T10:00:00`, amount: 45, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+', category: 'Taxes', remarks: `Ipad Mini ${n}/24 Tax` }),
  ]);
  const snap = makeSnapshot({ transactions: rows });

  const plans = emiPlans(snap, '2026-06-10');
  assert.equal(plans.length, 1, 'six rows are one plan, not six');

  const plan = plans[0]!;
  assert.equal(plan.name, 'Ipad Mini');
  assert.equal(plan.months, 24);
  assert.equal(plan.paidCount, 2);
  assert.equal(plan.remainingCount, 22);
  assert.equal(plan.instalmentAmount, 2295, 'principal + surcharge + tax');
  assert.equal(plan.paidAmount, 4590);
  assert.equal(plan.card, 'Coral');

  const summary = emiSummary(plans);
  assert.equal(summary.activeCount, 1);
  assert.equal(summary.monthlyOutgo, 2295);
});

/* --- Dates and amounts at the edges -------------------------------------- */

test('a transaction exactly on a window boundary is included once', () => {
  const snap = makeSnapshot({
    transactions: [
      tx({ ts: '2026-06-01T00:00:00', amount: 100 }),
      tx({ ts: '2026-06-30T23:59:59', amount: 200 }),
    ],
  });
  assert.equal(total(spendBetween(snap, '2026-06-01', '2026-06-30')), 300);
  assert.equal(total(spendBetween(snap, '2026-06-02', '2026-06-29')), 0);
});

test('month totals do not leak across a year boundary', () => {
  const snap = makeSnapshot({
    transactions: [
      tx({ ts: '2025-12-31T23:59:59', amount: 500 }),
      tx({ ts: '2026-01-01T00:00:00', amount: 700 }),
    ],
  });
  assert.equal(total(spendBetween(snap, '2025-12-01', '2025-12-31')), 500);
  assert.equal(total(spendBetween(snap, '2026-01-01', '2026-01-31')), 700);
});

test('a leap day is a real spending day', () => {
  const snap = makeSnapshot({ transactions: [tx({ ts: '2028-02-29T10:00:00', amount: 250 })] });
  assert.equal(total(spendBetween(snap, '2028-02-01', '2028-02-29')), 250);
  assert.equal(monthSummary(snap, '2028-02-29').daysInMonth, 29);
});

test('sub-rupee amounts survive aggregation', () => {
  const snap = makeSnapshot({
    transactions: [tx({ amount: 0.01 }), tx({ amount: 0.02 }), tx({ amount: 0.03 })],
  });
  assert.equal(total(spendBetween(snap, '2000-01-01', '2030-01-01')), 0.06);
});
