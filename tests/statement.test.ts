import assert from 'node:assert/strict';
import { test } from 'vitest';
import { creditLedger } from '@/lib/credit';
import { cycleFor, dueStatus } from '@/lib/cycles';
import { cardStatement, statementView } from '@/lib/statement';
import type { Card } from '@/lib/types';
import { fixtureTransactions, income, makeSnapshot, tx } from './helpers.ts';

/** A card with no carried history, so every figure is hand-checkable. */
const plain: Card = {
  name: 'Coral', billDate: 25, graceDays: 17, dueDay: 12, dueCycle: 'next',
  creditLimit: 50000, openingBalance: 0, openingDate: null, slot: 4, active: true,
  statementBoundary: 'inclusive',
};

test('cycle geometry: the closed cycle is the one that already billed', () => {
  // Billing on the 25th. On 10 Jun the June bill has not been cut yet, so the
  // live statement is May's: 26 Apr -> 25 May, due 12 Jun (dueCycle 'next').
  const c = cycleFor(plain, '2026-06-10');
  assert.equal(c.cycleStart, '2026-04-26');
  assert.equal(c.statementEnd, '2026-05-25');
  assert.equal(c.dueDate, '2026-06-12');
  assert.equal(c.nextStatementEnd, '2026-06-25');
});

test('cycle geometry: on the bill date itself the statement is that day', () => {
  const c = cycleFor(plain, '2026-06-25');
  assert.equal(c.statementEnd, '2026-06-25');
  assert.equal(c.cycleStart, '2026-05-26');
  assert.equal(c.dueDate, '2026-07-12');
});

test("cycle geometry: a 'same' month due day stays in the statement month", () => {
  const edge: Card = { ...plain, name: 'Edge', billDate: 6, dueDay: 21, dueCycle: 'same' };
  const c = cycleFor(edge, '2026-06-10');
  assert.equal(c.statementEnd, '2026-06-06');
  assert.equal(c.dueDate, '2026-06-21');
});

test('cycle geometry: with no due day it falls back to grace days', () => {
  const c = cycleFor({ ...plain, dueDay: null }, '2026-06-10');
  assert.equal(c.statementEnd, '2026-05-25');
  assert.equal(c.dueDate, '2026-06-11'); // 25 May + 17
});

test('a spend before the statement lands on the bill, after it lands unbilled', () => {
  const snap = makeSnapshot({
    cards: [plain],
    transactions: [
      // Inside the closed cycle (26 Apr - 25 May) -> billed
      tx({ ts: '2026-05-01T10:00:00', amount: 1000, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      // After the statement -> unbilled
      tx({ ts: '2026-06-01T10:00:00', amount: 400, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
    ],
  });
  const r = cardStatement(snap, plain, '2026-06-10');
  assert.equal(r.remainingDueBill, 1000);
  assert.equal(r.unbilled, 400);
  assert.equal(r.totalDebtLive, 1400);
});

test('a payment clears the bill first, and only the surplus reduces unbilled', () => {
  const snap = makeSnapshot({
    cards: [plain],
    transactions: [
      tx({ ts: '2026-05-01T10:00:00', amount: 1000, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      tx({ ts: '2026-06-01T10:00:00', amount: 400, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      // Paying 1200 clears the 1000 bill, leaving 200 against the 400 unbilled.
      tx({ ts: '2026-06-05T10:00:00', amount: 1200, method: 'Fi', category: 'Coral', kind: 'card_payment', cardAffected: 'Coral', cardDirection: 'debt-' }),
    ],
  });
  const r = cardStatement(snap, plain, '2026-06-10');
  assert.equal(r.remainingDueBill, 0);
  assert.equal(r.unbilled, 200);
  assert.equal(r.totalDebtLive, 200);
  assert.equal(r.status, 'paid');
});

test('an overpaid card reports negative debt rather than clamping to zero', () => {
  // The sheet behaves this way too (One Card showed -189.79). Hiding an
  // overpayment would misstate the reserve you need to hold.
  const snap = makeSnapshot({
    cards: [plain],
    transactions: [
      tx({ ts: '2026-05-01T10:00:00', amount: 500, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      tx({ ts: '2026-05-10T10:00:00', amount: 800, method: 'Fi', category: 'Coral', kind: 'card_payment', cardAffected: 'Coral', cardDirection: 'debt-' }),
    ],
  });
  const r = cardStatement(snap, plain, '2026-06-10');
  assert.equal(r.totalDebtLive, -300);
  assert.equal(r.remainingDueBill, 0);
  assert.equal(r.unbilled, -300);
});

test('the opening balance replaces history rather than adding to it', () => {
  const carried: Card = { ...plain, openingBalance: 2662.72, openingDate: '2025-12-15' };
  const snap = makeSnapshot({
    cards: [carried],
    transactions: [
      // Before tracking began: must be ignored, the opening balance covers it.
      tx({ ts: '2025-11-01T10:00:00', amount: 9999, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      // After: counts.
      tx({ ts: '2026-05-01T10:00:00', amount: 1000, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
    ],
  });
  const r = cardStatement(snap, carried, '2026-06-10');
  assert.equal(r.totalDebtLive, 3662.72); // 2662.72 + 1000, the 9999 excluded
});

test('future-dated rows do not count until their date arrives', () => {
  // Pre-logged EMI instalments sit in the data months ahead.
  const snap = makeSnapshot({
    cards: [plain],
    transactions: [
      tx({ ts: '2026-05-01T10:00:00', amount: 1000, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      tx({ ts: '2026-09-01T10:00:00', amount: 5000, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
    ],
  });
  assert.equal(cardStatement(snap, plain, '2026-06-10').totalDebtLive, 1000);
  // Once the date passes, it counts without any further action.
  assert.equal(cardStatement(snap, plain, '2026-09-15').totalDebtLive, 6000);
});

test('IDENTITY: remainingDue + unbilled always reconstructs totalDebtLive', () => {
  // The three headline figures are not independent. If this ever drifts, the
  // dashboard is telling the user three numbers that cannot all be true.
  const cases = [
    [1000, 400, 0], [1000, 400, 1200], [500, 0, 800], [0, 0, 0],
    [2500, 1750.25, 2500], [100, 100, 250], [3000, 0, 1000],
  ] as const;

  for (const [billed, after, paid] of cases) {
    const rows = [];
    if (billed) rows.push(tx({ ts: '2026-05-01T10:00:00', amount: billed, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }));
    if (after) rows.push(tx({ ts: '2026-06-01T10:00:00', amount: after, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }));
    if (paid) rows.push(tx({ ts: '2026-06-05T10:00:00', amount: paid, method: 'Fi', category: 'Coral', kind: 'card_payment', cardAffected: 'Coral', cardDirection: 'debt-' }));

    const r = cardStatement(makeSnapshot({ cards: [plain], transactions: rows }), plain, '2026-06-10');
    assert.equal(
      Math.round((r.remainingDueBill + r.unbilled) * 100) / 100,
      r.totalDebtLive,
      `identity broke for billed=${billed} after=${after} paid=${paid}`,
    );
  }
});

test('cycle math block adds up to the closing balance', () => {
  const snap = makeSnapshot({
    cards: [plain],
    transactions: [
      tx({ ts: '2026-03-01T10:00:00', amount: 1506.52, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      tx({ ts: '2026-05-01T10:00:00', amount: 2648.48, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
      tx({ ts: '2026-05-10T10:00:00', amount: 4136.03, method: 'Fi', category: 'Coral', kind: 'card_payment', cardAffected: 'Coral', cardDirection: 'debt-' }),
    ],
  });
  const m = cardStatement(snap, plain, '2026-06-10').cycleMath;
  assert.equal(m.openingBalance, 1506.52);
  assert.equal(m.cycleSpends, 2648.48);
  assert.equal(m.cycleRepayments, 4136.03);
  // Mirrors the worked example on the sheet's Coral panel.
  assert.equal(m.closingBalance, 18.97);
});

test('due status thresholds', () => {
  assert.equal(dueStatus(0, 30), 'paid');
  assert.equal(dueStatus(500, -1), 'overdue');
  assert.equal(dueStatus(500, 3), 'due-soon');
  assert.equal(dueStatus(500, 20), 'safe');
});

test('excluding credit removes only lending that is still unpaid', () => {
  const snap = makeSnapshot({
    cards: [plain],
    transactions: [
      // Lent 2000 on the card. Still owed -> excluded from "my" debt.
      tx({ ts: '2026-05-01T10:00:00', amount: 2000, method: 'Coral', category: 'Credit Given', kind: 'credit_given', cardAffected: 'Coral', cardDirection: 'debt+', remarks: 'Fayiz', tags: { person: 'Fayiz' } }),
      // Own spend on the same card.
      tx({ ts: '2026-05-02T10:00:00', amount: 1000, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+' }),
    ],
  });

  const before = statementView(snap, '2026-06-10').rows[0]!;
  assert.equal(before.totalDebtLive, 3000);
  assert.equal(before.totalDebtExcl, 1000, 'unrepaid lending should be excluded');

  // Now Fayiz pays it back. v2 kept excluding it regardless; the debt is
  // genuinely Farooq's once the money is returned.
  const after = statementView(
    makeSnapshot({
      ...snap,
      income: [income({ ts: '2026-06-02T10:00:00', amount: 2000, source: 'Credit Return', remarks: 'Fayiz repayment' })],
    }),
    '2026-06-10',
  ).rows[0]!;
  assert.equal(after.totalDebtLive, 3000);
  assert.equal(after.totalDebtExcl, 3000, 'repaid lending must stop being excluded');
});

test('the credit exclusion respects the card tracking window', () => {
  // Lending charged before tracking began is not part of this balance — the
  // opening balance stands in for that era. Excluding it anyway made Coral
  // report more money "lent out" than the card carried in total.
  const carried: Card = { ...plain, openingBalance: 1000, openingDate: '2026-01-01' };
  const snap = makeSnapshot({
    cards: [carried],
    transactions: [
      // Long before tracking started, never repaid.
      tx({ ts: '2023-05-01T10:00:00', amount: 30000, method: 'Coral', category: 'Credit Given', kind: 'credit_given', cardAffected: 'Coral', cardDirection: 'debt+', remarks: 'Irshad', tags: { person: 'Irshad' } }),
      // Inside the tracked window.
      tx({ ts: '2026-05-01T10:00:00', amount: 500, method: 'Coral', category: 'Credit Given', kind: 'credit_given', cardAffected: 'Coral', cardDirection: 'debt+', remarks: 'Jinan', tags: { person: 'Jinan' } }),
    ],
  });

  const r = cardStatement(snap, carried, '2026-06-10', creditLedger(snap).outstandingByTx);
  assert.equal(r.totalDebtLive, 1500, 'pre-tracking lending must not inflate the balance');
  // Only the 500 inside the window may be excluded, not the 30000 outside it.
  assert.equal(r.creditGivenOutstanding, 500);
  assert.equal(r.totalDebtExcl, 1000);
  // And the exclusion can never exceed the balance it is subtracted from.
  assert.ok(r.creditGivenOutstanding <= r.totalDebtLive);
});

test('credit ledger allocates repayments oldest-first', () => {
  const snap = makeSnapshot({
    transactions: [
      tx({ ts: '2026-01-01T10:00:00', amount: 1000, category: 'Credit Given', kind: 'credit_given', remarks: 'Fayiz', tags: { person: 'Fayiz' } }),
      tx({ ts: '2026-02-01T10:00:00', amount: 500, category: 'Credit Given', kind: 'credit_given', remarks: 'Fayiz', tags: { person: 'Fayiz' } }),
    ],
    income: [income({ ts: '2026-03-01T10:00:00', amount: 1200, source: 'Credit Return', remarks: 'Fayiz paid back' })],
  });

  const l = creditLedger(snap);
  const fayiz = l.people.find((p) => p.person === 'Fayiz')!;
  assert.equal(fayiz.given, 1500);
  assert.equal(fayiz.repaid, 1200);
  assert.equal(fayiz.outstanding, 300);
  // The January loan is settled in full; February carries the remainder.
  assert.equal(fayiz.lendings[0]!.outstanding, 0);
  assert.equal(fayiz.lendings[1]!.outstanding, 300);
});

test('over-repayment never turns into a debt Farooq owes', () => {
  const snap = makeSnapshot({
    transactions: [tx({ ts: '2026-01-01T10:00:00', amount: 500, category: 'Credit Given', kind: 'credit_given', remarks: 'Sia', tags: { person: 'Sia' } })],
    income: [income({ ts: '2026-02-01T10:00:00', amount: 900, source: 'Credit Return', remarks: 'Sia repayment' })],
  });
  assert.equal(creditLedger(snap).totalOutstanding, 0);
});

test('the whole engine runs over the real fixture and stays coherent', async () => {
  const snap = makeSnapshot({ transactions: await fixtureTransactions() });
  const view = statementView(snap, '2026-06-10');

  assert.equal(view.rows.length, 6, 'every active card should report');

  for (const r of view.rows) {
    assert.ok(Number.isFinite(r.totalDebtLive), `${r.card} produced a non-finite balance`);
    assert.ok(r.remainingDueBill >= 0, `${r.card} reported a negative bill`);
    assert.equal(
      Math.round((r.remainingDueBill + r.unbilled) * 100) / 100,
      r.totalDebtLive,
      `${r.card} broke the debt identity`,
    );
    assert.ok(r.cycle.statementEnd <= '2026-06-10', `${r.card} billed in the future`);
    assert.ok(r.cycle.cycleStart < r.cycle.statementEnd);
    // Excluding credit can never make the debt larger.
    assert.ok(r.totalDebtExcl <= r.totalDebtLive + 0.005, `${r.card} excl-credit exceeds live debt`);
  }

  // Totals must equal the sum of the parts.
  const manual = Math.round(view.rows.reduce((a, r) => a + r.totalDebtLive, 0) * 100) / 100;
  assert.equal(view.totals.totalDebtLive, manual);
});
