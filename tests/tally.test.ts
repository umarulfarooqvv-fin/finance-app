import assert from 'node:assert/strict';
import { test } from 'vitest';
import { tally } from '@/lib/tally';
import { accountBalances } from '@/lib/balances';
import { makeSnapshot, tx, income } from './helpers';

/* ===========================================================================
   The date-wise statement.

   A reconciliation page is only worth having if its own arithmetic is exact.
   These assert the identity rather than the presentation: opening plus what
   came in, minus what went out, IS the closing figure — on every scope, every
   window, and at every boundary.
   =========================================================================== */

const snap = () =>
  makeSnapshot({
    accounts: [
      { name: 'Fi', kind: 'bank', openingBalance: 10000, since: '2026-09-01', active: true },
      { name: 'Cash', kind: 'cash', openingBalance: 500, since: '2026-09-01', active: true },
    ],
    transactions: [
      tx({ ts: '2026-09-02T10:00:00', amount: 300, method: 'Fi', category: 'Food', remarks: 'Lunch' }),
      tx({ ts: '2026-09-02T18:00:00', amount: 200, method: 'Cash', category: 'Food', remarks: 'Tea' }),
      tx({ ts: '2026-09-05T09:00:00', amount: 1200.55, method: 'Fi', category: 'Groceries' }),
      // On a card: no cash moves, so it must not appear in the statement.
      tx({ ts: '2026-09-05T11:00:00', amount: 999, method: 'Coral', category: 'Personal' }),
    ],
    income: [
      income({ ts: '2026-09-03T12:00:00', amount: 45000, account: 'Fi', source: 'Salary' }),
      income({ ts: '2026-09-06T12:00:00', amount: 100, account: 'Cash', source: 'Credit Return' }),
    ],
  });

test('opening plus in, minus out, is the closing figure', () => {
  const t = tally(snap(), '2026-09-01', '2026-09-30', null);
  assert.equal(t.opening, 10500, '10,000 + 500 carried in');
  assert.equal(t.totalIn, 45100);
  assert.equal(t.totalOut, 1700.55);
  assert.equal(t.closing, 53899.45);
  assert.equal(t.drift, 0, 'the page must never show an unexplained difference');
});

test('card spending is reported but never moves the balance', () => {
  const t = tally(snap(), '2026-09-01', '2026-09-30', null);
  assert.equal(t.cardSpend, 999);
  const everyMovement = t.days.flatMap((d) => d.movements);
  assert.ok(!everyMovement.some((m) => m.counterparty === 'Coral'), 'no cash left an account');
  // And it is genuinely excluded from the arithmetic, not merely hidden.
  assert.equal(t.opening + t.totalIn - t.totalOut, t.closing);
});

test('scoping to one account leaves the other one out entirely', () => {
  const fi = tally(snap(), '2026-09-01', '2026-09-30', 'Fi');
  assert.equal(fi.opening, 10000);
  assert.equal(fi.totalIn, 45000);
  assert.equal(fi.totalOut, 1500.55);
  assert.equal(fi.closing, 53499.45);
  assert.equal(fi.drift, 0);

  const cash = tally(snap(), '2026-09-01', '2026-09-30', 'Cash');
  // The parts must add up to the whole, or one of the three views is lying.
  const all = tally(snap(), '2026-09-01', '2026-09-30', null);
  assert.equal(fi.closing + cash.closing, all.closing);
  assert.equal(fi.totalOut + cash.totalOut, all.totalOut);
});

test('the closing figure agrees with the Money page for the same day', () => {
  // Two separate code paths over the same data. If they disagree, one of the
  // two screens is wrong and there is no way to tell which from either alone.
  const s = snap();
  const t = tally(s, '2026-09-01', '2026-09-30', 'Fi');
  const fi = accountBalances(s, '2026-09-30').find((a) => a.name === 'Fi');
  assert.equal(t.closing, fi?.balance);
});

test('a window that starts mid-period carries the right balance into it', () => {
  const t = tally(snap(), '2026-09-05', '2026-09-30', null);
  // 10,500 opening, minus 500 spent on the 2nd, plus 45,000 on the 3rd.
  assert.equal(t.opening, 55000);
  assert.equal(t.totalOut, 1200.55);
  assert.equal(t.closing, 53899.45, 'the same closing figure, reached from a later start');
  assert.equal(t.drift, 0);
});

test('boundaries are inclusive at both ends', () => {
  const justTheSecond = tally(snap(), '2026-09-02', '2026-09-02', null);
  assert.equal(justTheSecond.totalOut, 500, 'both entries dated the 2nd count');
  assert.equal(justTheSecond.days.length, 1);

  const justTheThird = tally(snap(), '2026-09-03', '2026-09-03', null);
  assert.equal(justTheThird.totalIn, 45000);
});

test('movements before an account is tracked from are not counted twice', () => {
  // The opening balance already includes them; counting them again would
  // subtract the same spending from the balance a second time.
  const s = makeSnapshot({
    accounts: [{ name: 'Fi', kind: 'bank', openingBalance: 10000, since: '2026-09-01', active: true }],
    transactions: [
      tx({ ts: '2026-08-20T10:00:00', amount: 5000, method: 'Fi', category: 'Food' }),
      tx({ ts: '2026-09-02T10:00:00', amount: 300, method: 'Fi', category: 'Food' }),
    ],
  });
  const t = tally(s, '2026-08-01', '2026-09-30', null);
  assert.equal(t.totalOut, 300, 'the August row is before tracking began');
  assert.equal(t.opening, 10000);
  assert.equal(t.closing, 9700);
});

test('a period with nothing in it is empty rather than wrong', () => {
  const t = tally(snap(), '2026-10-01', '2026-10-31', null);
  assert.equal(t.days.length, 0);
  assert.equal(t.totalIn, 0);
  assert.equal(t.totalOut, 0);
  assert.equal(t.opening, t.closing, 'nothing happened, so nothing changed');
  assert.equal(t.drift, 0);
});

test('days run newest first, and each balance is the one after that day', () => {
  const t = tally(snap(), '2026-09-01', '2026-09-30', null);
  const days = t.days.map((d) => d.day);
  assert.deepEqual(days, [...days].sort().reverse(), 'newest first, like every other list');

  const second = t.days.find((d) => d.day === '2026-09-02');
  assert.equal(second?.balance, 10000, '10,500 opening less 500 spent that day');
  const third = t.days.find((d) => d.day === '2026-09-03');
  assert.equal(third?.balance, 55000);
});

test('running balances are consistent with the day lines that produced them', () => {
  const t = tally(snap(), '2026-09-01', '2026-09-30', null);
  // Walk it forwards and re-derive every balance from scratch.
  let running = t.opening;
  for (const d of [...t.days].reverse()) {
    running = Math.round((running + d.in - d.out) * 100) / 100;
    assert.equal(d.balance, running, `balance on ${d.day}`);
    assert.equal(d.net, Math.round((d.in - d.out) * 100) / 100);
  }
  assert.equal(running, t.closing);
});
