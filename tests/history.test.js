import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRow } from '../lib/parser.js';
import { cycleDates } from '../lib/cycles.js';

test('older-history classification (from sheet findings)', () => {
  // Category "Credit Card" = bill payment; target card named in remarks
  const cc = classifyRow({ amount: 4760, method: 'Jupiter', category: 'Credit Card', remarks: 'Edge Credit Card Bill Payment' });
  assert.equal(cc.kind, 'card_payment');
  assert.equal(cc.cardAffected.card, 'Edge');
  assert.equal(cc.cardAffected.direction, 'debt-');

  // Category "Investment" = transfer, not a spend
  const inv = classifyRow({ amount: 5000, method: 'Fi', category: 'Investment', remarks: 'Gold' });
  assert.equal(inv.kind, 'investment');

  // Medicine / Groceries are real spend categories in older data
  assert.equal(classifyRow({ amount: 316, method: 'Fi', category: 'Medicine', remarks: 'Rosemary' }).kind, 'spend');
  assert.equal(classifyRow({ amount: 53, method: 'Edge', category: 'Groceries', remarks: 'Banana' }).kind, 'spend');

  // SBI / RBL / Canara are non-card money sources (no card debt)
  const sbi = classifyRow({ amount: 2528, method: 'SBI', category: 'Food', remarks: 'x' });
  assert.equal(sbi.isCardMethod, false);
  assert.equal(sbi.cardAffected, null);
});

test('due-day + cycle model (from Card_Settings)', () => {
  const now = new Date(2026, 6, 20); // 20-Jul-2026
  // Edge: statement day 6, due 21 SAME month → due 21 Jul
  const edge = cycleDates(6, 15, now, 21, 'same');
  assert.equal(edge.dueDate.getDate(), 21);
  assert.equal(edge.dueDate.getMonth(), edge.statementEnd.getMonth());

  // One Card: statement day 22, due 8 NEXT month
  const oc = cycleDates(22, 16, now, 8, 'next');
  assert.equal(oc.dueDate.getDate(), 8);
  const nextMonth = (oc.statementEnd.getMonth() + 1) % 12;
  assert.equal(oc.dueDate.getMonth(), nextMonth);

  // Fallback to graceDays when no dueDay
  const fb = cycleDates(6, 15, now);
  assert.equal(fb.dueDate.getDate(), 21); // 6 + 15
});
