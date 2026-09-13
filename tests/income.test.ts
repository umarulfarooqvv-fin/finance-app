import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildIncomeRow, incomeIdFromContent, incomeIdFromKey } from '@/lib/income';
import type { IncomeInput } from '@/lib/validation';

/* ===========================================================================
   The income write path.

   Income was the one financial row with no way in or out: the Shortcut could
   post it and the importer could load it, but nothing could correct one. The
   rules below are the two that decide whether a salary gets counted once.
   =========================================================================== */

const input = (over: Partial<IncomeInput> = {}): IncomeInput => ({
  amount: '45000',
  source: 'Salary',
  account: 'Fi',
  remarks: 'March Salary',
  ts: '2026-06-11T16:24:33',
  ...over,
});

/* --- Idempotency ---------------------------------------------------------- */

test('the same posted entry always resolves to the same id', async () => {
  // This is the whole defence against a retried Shortcut post. The route used
  // Math.random() here, so a flaky connection recorded the salary twice.
  const parts = ['2026-06-11T16:24:33', '45000', 'Salary', 'Fi', 'March Salary'];
  const first = await incomeIdFromContent(parts);
  for (let i = 0; i < 10; i++) {
    assert.equal(await incomeIdFromContent(parts), first);
  }
  assert.match(first, /^inc-[0-9a-f]{16}$/);
});

test('a different entry resolves to a different id', async () => {
  const base = ['2026-06-11T16:24:33', '45000', 'Salary', 'Fi', 'March Salary'];
  const id = await incomeIdFromContent(base);
  for (const changed of [
    ['2026-06-11T16:24:34', '45000', 'Salary', 'Fi', 'March Salary'],
    ['2026-06-11T16:24:33', '45001', 'Salary', 'Fi', 'March Salary'],
    ['2026-06-11T16:24:33', '45000', 'Freelance', 'Fi', 'March Salary'],
    ['2026-06-11T16:24:33', '45000', 'Salary', 'Jupiter', 'March Salary'],
    ['2026-06-11T16:24:33', '45000', 'Salary', 'Fi', 'April Salary'],
  ]) {
    assert.notEqual(await incomeIdFromContent(changed), id, changed.join('|'));
  }
});

test('a client key gives a stable id too, and a different namespace', async () => {
  const a = await incomeIdFromKey('dialog-abc');
  assert.equal(await incomeIdFromKey('dialog-abc'), a);
  assert.notEqual(await incomeIdFromKey('dialog-abd'), a);
  // Content ids and key ids must not collide into one another's space.
  assert.match(a, /^inc-[0-9a-f]{24}$/);
});

/* --- Building the row ----------------------------------------------------- */

test('an amount is parsed the way the rest of the app parses money', () => {
  assert.equal(buildIncomeRow(input({ amount: '1,23,456.78' }), 'inc-x').amount, 123456.78);
  assert.equal(buildIncomeRow(input({ amount: '₹ 45000 ' }), 'inc-x').amount, 45000);
  assert.equal(buildIncomeRow(input({ amount: 45000 }), 'inc-x').amount, 45000);
});

test('building with an unvalidated amount throws rather than writing a null', () => {
  // buildIncomeRow trusts validation; if it is ever called without it, that
  // must fail loudly instead of inserting a row with no amount.
  assert.throws(() => buildIncomeRow(input({ amount: 'abc' }), 'inc-x'));
  assert.throws(() => buildIncomeRow(input({ amount: '' }), 'inc-x'));
});

test('a row that cannot be attributed is flagged, not silently counted', () => {
  // An income row with no account still inflates every total it appears in.
  // Flagging it is what makes it findable rather than invisible.
  assert.equal(buildIncomeRow(input(), 'inc-x').needs_review, false);
  assert.equal(buildIncomeRow(input({ account: '' }), 'inc-x').needs_review, true);
  assert.equal(buildIncomeRow(input({ source: '  ' }), 'inc-x').needs_review, true);
});

test('fields are trimmed, and a new row is never pre-deleted', () => {
  const row = buildIncomeRow(input({ source: ' Salary ', account: ' Fi ', remarks: ' March ' }), 'inc-x');
  assert.equal(row.source, 'Salary');
  assert.equal(row.account, 'Fi');
  assert.equal(row.remarks, 'March');
  assert.equal(row.deleted, false);
  assert.equal(row.id, 'inc-x');
  assert.equal(row.ts, '2026-06-11T16:24:33');
});
