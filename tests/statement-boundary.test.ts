import assert from 'node:assert/strict';
import { test } from 'vitest';
import { boundaryFor, cycleFor, cycleOf, type Cycle, type CycleOverrides } from '@/lib/cycles';
import { cardStatement } from '@/lib/statement';
import { closingBalanceUnder, reconcileCycle, rowsOnBoundary } from '@/lib/reconcile';
import { addDays, daysBetween } from '@/lib/time';
import type { Card } from '@/lib/types';
import { makeSnapshot, tx } from './helpers.ts';

/* ===========================================================================
   The statement cut-off.

   A bank generates a statement at some moment during the bill date, so whether
   that day's own spending made it onto that statement genuinely varies month
   to month. These tests pin two things:

     1. The boundary does what it says.
     2. Consecutive cycles TILE the timeline — no gap, no overlap — whichever
        way each individual month falls. This is the part that matters: a gap
        means a transaction appears on no statement at all and quietly vanishes
        from both.
   =========================================================================== */

const coral: Card = {
  name: 'Coral', billDate: 25, graceDays: 17, dueDay: 12, dueCycle: 'next',
  creditLimit: 50000, openingBalance: 0, openingDate: null, slot: 4, active: true,
  statementBoundary: 'inclusive',
};

const charge = (ts: string, amount: number, remarks = '') =>
  tx({ ts, amount, method: 'Coral', cardAffected: 'Coral', cardDirection: 'debt+', remarks });

/* --- The rule itself ----------------------------------------------------- */

test('inclusive puts the bill date on that statement', () => {
  const c = cycleFor(coral, '2026-06-10');
  assert.equal(c.statementEnd, '2026-05-25');
  assert.equal(c.periodEnd, '2026-05-25', 'the period runs to the bill date itself');
  assert.equal(c.cycleStart, '2026-04-26');
  assert.equal(c.boundary, 'inclusive');
});

test('exclusive cuts the statement before the bill date', () => {
  const c = cycleFor({ ...coral, statementBoundary: 'exclusive' }, '2026-06-10');
  // The bank still GENERATES it on the 25th — that date is what is printed —
  // but the spending it covers stops the day before.
  assert.equal(c.statementEnd, '2026-05-25', 'the statement is still dated the 25th');
  assert.equal(c.periodEnd, '2026-05-24', 'but it covers only up to the 24th');
  assert.equal(c.boundary, 'exclusive');
});

test('an exclusive cycle starts ON the previous bill date, not after it', () => {
  // Otherwise 25 Apr would be billed by nobody: excluded from April's
  // statement for being its bill date, and missed by May's for being before
  // its start. The chaining is what closes that hole.
  const c = cycleFor({ ...coral, statementBoundary: 'exclusive' }, '2026-06-10');
  assert.equal(c.cycleStart, '2026-04-25');
  assert.equal(c.periodEnd, '2026-05-24');
});

test('a bill-date charge moves between statements with the boundary', () => {
  const rows = [
    charge('2026-05-20T10:00:00', 1000, 'before the cut'),
    charge('2026-05-25T18:00:00', 400, 'on the bill date'),
  ];

  const inclusive = cardStatement(
    makeSnapshot({ cards: [coral], transactions: rows }), coral, '2026-06-10',
  );
  assert.equal(inclusive.remainingDueBill, 1400, 'inclusive bills both');
  assert.equal(inclusive.unbilled, 0);

  const exclusiveCard = { ...coral, statementBoundary: 'exclusive' as const };
  const exclusive = cardStatement(
    makeSnapshot({ cards: [exclusiveCard], transactions: rows }), exclusiveCard, '2026-06-10',
  );
  assert.equal(exclusive.remainingDueBill, 1000, 'exclusive bills only the earlier one');
  assert.equal(exclusive.unbilled, 400, 'and the bill-date charge rolls forward');

  // Either way the money still exists exactly once.
  assert.equal(inclusive.totalDebtLive, 1400);
  assert.equal(exclusive.totalDebtLive, 1400);
});

/* --- Per-cycle overrides ------------------------------------------------- */

test('one month can differ from the card default', () => {
  const overrides: CycleOverrides = { Coral: { '2026-05-25': { boundary: 'exclusive' } } };
  assert.equal(boundaryFor(coral, '2026-05-25', overrides), 'exclusive');
  assert.equal(boundaryFor(coral, '2026-06-25', overrides), 'inclusive', 'other months are untouched');

  const c = cycleFor(coral, '2026-06-10', overrides);
  assert.equal(c.boundary, 'exclusive');
  assert.equal(c.periodEnd, '2026-05-24');
});

test('INVARIANT: consecutive cycles tile the timeline, however each month falls', () => {
  // The dangerous case is a mixed run: if May is exclusive and June inclusive,
  // does 25 May end up on exactly one statement?
  const patterns: CycleOverrides[] = [
    {},
    { Coral: { '2026-05-25': { boundary: 'exclusive' } } },
    { Coral: { '2026-06-25': { boundary: 'exclusive' } } },
    { Coral: { '2026-05-25': { boundary: 'exclusive' }, '2026-06-25': { boundary: 'exclusive' } } },
    { Coral: { '2026-04-25': { boundary: 'exclusive' }, '2026-06-25': { boundary: 'exclusive' } } },
  ];

  for (const overrides of patterns) {
    // Walk several consecutive cycles, newest first.
    const cycles: Cycle[] = [];
    let cursor = '2026-08-10';
    for (let i = 0; i < 5; i++) {
      const c = cycleFor(coral, cursor, overrides);
      cycles.push(c);
      // Step back from the statement date: under an exclusive boundary the
      // period starts ON the previous statement date, so stepping back from
      // the start would skip a month.
      cursor = addDays(c.statementEnd, -1);
    }

    // Each cycle must hand over to the next with no day counted twice and no
    // day skipped: the earlier cycle's period must end exactly one day before
    // the later cycle begins.
    for (let i = 0; i < cycles.length - 1; i++) {
      const later = cycles[i]!;
      const earlier = cycles[i + 1]!;
      const gap = daysBetween(earlier.periodEnd, later.cycleStart);
      assert.equal(
        gap, 1,
        `cycles must abut: ${earlier.statementEnd} ends ${earlier.periodEnd}, ` +
        `${later.statementEnd} starts ${later.cycleStart} (gap ${gap} days)`,
      );
    }

    // And every period must be a sane, non-empty window.
    for (const c of cycles) {
      assert.ok(
        daysBetween(c.cycleStart, c.periodEnd) >= 0,
        `${c.statementEnd}: period runs backwards`,
      );
    }
  }
});

test('INVARIANT: no charge is billed twice or lost, whatever the pattern', () => {
  // One charge on every day across two cycle boundaries.
  const rows = [];
  for (let d = 20; d <= 30; d++) rows.push(charge(`2026-05-${d}T12:00:00`, 10, `may-${d}`));
  for (let d = 1; d <= 5; d++) rows.push(charge(`2026-06-0${d}T12:00:00`, 10, `jun-${d}`));

  const patterns: CycleOverrides[] = [
    {},
    { Coral: { '2026-05-25': { boundary: 'exclusive' } } },
  ];
  for (const overrides of patterns) {
    const snap = makeSnapshot({ cards: [coral], transactions: rows });
    const r = cardStatement(snap, coral, '2026-06-10', {}, overrides);
    // Total debt is boundary-independent: moving the cut-off changes WHICH
    // statement a charge lands on, never whether it is owed.
    assert.equal(r.totalDebtLive, 160, 'all 16 charges are owed regardless');
    assert.equal(
      Math.round((r.remainingDueBill + r.unbilled) * 100) / 100,
      r.totalDebtLive,
      'the debt identity holds under both boundaries',
    );
  }
});

/* --- Reconciliation ------------------------------------------------------ */

test('the boundary is deduced from what the bank actually billed', () => {
  const snap = makeSnapshot({
    cards: [coral],
    transactions: [
      charge('2026-05-20T10:00:00', 1000, 'before'),
      charge('2026-05-25T18:00:00', 400, 'on the bill date'),
    ],
  });

  // Bank says 1,400 -> the bill-date charge was included.
  const included = reconcileCycle(snap, coral, '2026-05-25', 1400);
  assert.deepEqual(included.verdict, { kind: 'resolved', boundary: 'inclusive', total: 1400 });

  // Bank says 1,000 -> it was not.
  const excluded = reconcileCycle(snap, coral, '2026-05-25', 1000);
  assert.deepEqual(excluded.verdict, { kind: 'resolved', boundary: 'exclusive', total: 1000 });

  // The disputed row is surfaced either way, so the answer is checkable.
  assert.equal(included.onBoundary.length, 1);
  assert.equal(included.onBoundary[0]!.amount, 400);
  assert.equal(included.onBoundary[0]!.direction, 'charge');
});

test('when nothing falls on the bill date, the boundary does not matter', () => {
  const snap = makeSnapshot({
    cards: [coral],
    transactions: [charge('2026-05-20T10:00:00', 1000)],
  });
  const r = reconcileCycle(snap, coral, '2026-05-25', 1000);
  assert.deepEqual(r.verdict, { kind: 'indifferent', total: 1000 });
  assert.deepEqual(r.onBoundary, []);
});

test('a figure neither boundary explains is reported, not rounded away', () => {
  // This is the valuable case: the gap means something is genuinely missing —
  // a fee, a forgotten row, a wrong amount — and picking the closer of two
  // wrong numbers would bury it.
  const snap = makeSnapshot({
    cards: [coral],
    transactions: [
      charge('2026-05-20T10:00:00', 1000),
      charge('2026-05-25T18:00:00', 400),
    ],
  });
  const r = reconcileCycle(snap, coral, '2026-05-25', 1750);
  assert.equal(r.verdict.kind, 'unexplained');
  if (r.verdict.kind === 'unexplained') {
    assert.equal(r.verdict.inclusive, 1400);
    assert.equal(r.verdict.exclusive, 1000);
    assert.equal(r.verdict.shortfall, 350, 'the bank billed 350 more than we can account for');
  }
});

test('payments on the bill date move with the boundary too', () => {
  const snap = makeSnapshot({
    cards: [coral],
    transactions: [
      charge('2026-05-10T10:00:00', 2000),
      tx({
        ts: '2026-05-25T09:00:00', amount: 500, method: 'Fi', category: 'Coral',
        kind: 'card_payment', cardAffected: 'Coral', cardDirection: 'debt-',
        remarks: 'paid on the bill date',
      }),
    ],
  });
  assert.equal(closingBalanceUnder(snap, coral, '2026-05-25', 'inclusive'), 1500);
  assert.equal(closingBalanceUnder(snap, coral, '2026-05-25', 'exclusive'), 2000);

  const onDate = rowsOnBoundary(snap, coral, '2026-05-25');
  assert.equal(onDate.length, 1);
  assert.equal(onDate[0]!.direction, 'payment');
});

test('the opening balance is carried into the reconciled figure', () => {
  const carried: Card = { ...coral, openingBalance: 2662.72, openingDate: '2025-12-15' };
  const snap = makeSnapshot({
    cards: [carried],
    transactions: [charge('2026-05-20T10:00:00', 1000)],
  });
  assert.equal(closingBalanceUnder(snap, carried, '2026-05-25', 'inclusive'), 3662.72);
});

/* ---------------------------------------------------------------------------
   Which statement will bill a given transaction.

   `cycleFor` answers "what is this card's latest statement" and walks BACK to
   the last bill date already passed. Asked about a transaction that is the
   wrong question by a whole month, and the answer is a statement that closed
   before the money was spent. These pin the difference.
   --------------------------------------------------------------------------- */

const scapia: Card = {
  name: 'Scapia', billDate: 14, graceDays: 15, dueDay: 29, dueCycle: 'same',
  creditLimit: 50000, openingBalance: 0, openingDate: null, slot: 5, active: true,
  statementBoundary: 'inclusive',
};

test('a charge before this month\'s bill date is billed by THIS month, not last', () => {
  // The regression: 7 Aug on a card billing the 14th came back as 14 Jul — a
  // statement already issued and paid by the time the money was spent.
  const c = cycleOf(scapia, '2026-08-07T12:00:00');
  assert.equal(c.statementEnd, '2026-08-14');
  assert.equal(c.cycleStart, '2026-07-15');
});

test('a charge after the bill date rolls to next month', () => {
  const c = cycleOf(scapia, '2026-08-22T12:00:00');
  assert.equal(c.statementEnd, '2026-09-14');
});

test('a charge ON the bill date lands per the boundary', () => {
  assert.equal(cycleOf(scapia, '2026-08-14T12:00:00').statementEnd, '2026-08-14');
  const exclusive: Card = { ...scapia, statementBoundary: 'exclusive' };
  // Cut before that day's spending, so it is billed a month later.
  assert.equal(cycleOf(exclusive, '2026-08-14T12:00:00').statementEnd, '2026-09-14');
});

test('the cycle returned always CONTAINS the day, every card, every day of a year', () => {
  // The property the whole thing rests on. A cycle that does not contain the
  // transaction is not that transaction's statement, whatever else is true.
  const cards: Card[] = [
    scapia,
    { ...scapia, name: 'Edge', billDate: 6 },
    { ...scapia, name: 'One Card', billDate: 22 },
    { ...scapia, name: 'Coral', billDate: 25 },
    { ...scapia, name: 'Month end', billDate: 31 },
    { ...scapia, name: 'Exclusive', billDate: 14, statementBoundary: 'exclusive' },
  ];
  for (const card of cards) {
    let day = '2026-01-01';
    for (let i = 0; i < 365; i++) {
      const c = cycleOf(card, `${day}T12:00:00`);
      assert.ok(
        day >= c.cycleStart && day <= c.periodEnd,
        `${card.name}: ${day} not inside ${c.cycleStart}..${c.periodEnd} (statement ${c.statementEnd})`,
      );
      day = addDays(day, 1);
    }
  }
});
