import assert from 'node:assert/strict';
import { test } from 'vitest';
import { isValidInstant, validateIncome, validateTransaction, MAX_REMARKS } from '@/lib/validation';
import { buildRow, idFromKey } from '@/lib/transactions';
import { MAX_AMOUNT } from '@/lib/money';

/* ===========================================================================
   The write path.

   Everything here is the server's decision, not the browser's: a client that
   skips the form entirely and posts straight at the action must hit exactly
   these rules.
   =========================================================================== */

const TODAY = '2026-08-22';
const valid = {
  amount: '480',
  method: 'Coral',
  category: 'Food',
  remarks: 'Lunch',
  ts: '2026-08-22T13:30:00',
};

/* --- Creation ------------------------------------------------------------ */

test('a well-formed entry passes', () => {
  assert.equal(validateTransaction(valid, TODAY), null);
});

test('an amount is required, positive, and no finer than a paisa', () => {
  const bad = (amount: unknown) =>
    validateTransaction({ ...valid, amount: amount as string }, TODAY)?.['amount'];

  assert.match(bad('') ?? '', /Enter an amount/);
  assert.match(bad(null) ?? '', /Enter an amount/);
  assert.match(bad('abc') ?? '', /not a number/);
  assert.match(bad('10.999') ?? '', /paisa/);
  assert.match(bad(String(MAX_AMOUNT + 1)) ?? '', /under/);
  // Direction is carried by category and method. A minus sign would silently
  // invert a balance, so it is refused rather than interpreted.
  assert.match(bad('-100') ?? '', /positive/);
  assert.match(bad('0') ?? '', /positive/);
});

test('the date must be a real point on the calendar', () => {
  const bad = (ts: string) => validateTransaction({ ...valid, ts }, TODAY)?.['ts'];

  assert.match(bad('') ?? '', /Pick a date/);
  assert.match(bad('not-a-date') ?? '', /not a real date/);
  assert.match(bad('2026-02-30T10:00:00') ?? '', /not a real date/); // February has no 30th
  assert.match(bad('2026-13-01T10:00:00') ?? '', /not a real date/);
  assert.match(bad('2026-08-22T25:00:00') ?? '', /not a real date/);
  assert.match(bad('1999-01-01T10:00:00') ?? '', /before/);
  assert.match(bad('2099-01-01T10:00:00') ?? '', /years ahead/);

  // Leap years are real dates.
  assert.equal(bad('2028-02-29T10:00:00'), undefined);
  assert.equal(isValidInstant('2027-02-29T10:00:00'), false);
});

test('a pre-logged future instalment is allowed, an absurd one is not', () => {
  // EMI rows are legitimately entered up to a couple of years ahead.
  assert.equal(validateTransaction({ ...valid, ts: '2028-02-11T00:00:00' }, TODAY), null);
  assert.ok(validateTransaction({ ...valid, ts: '2040-01-01T00:00:00' }, TODAY)?.['ts']);
});

test('method and category must both be known values', () => {
  assert.match(
    validateTransaction({ ...valid, method: '' }, TODAY)?.['method'] ?? '',
    /where the money came from/,
  );
  assert.match(
    validateTransaction({ ...valid, method: 'Bitcoin' }, TODAY)?.['method'] ?? '',
    /not a known payment method/,
  );
  assert.match(validateTransaction({ ...valid, category: '' }, TODAY)?.['category'] ?? '', /Choose a category/);
  assert.match(
    validateTransaction({ ...valid, category: 'Yacht' }, TODAY)?.['category'] ?? '',
    /not a known category/,
  );
});

test('a card cannot pay its own bill', () => {
  // The row would add and remove the same debt: the balance would not move,
  // and the entry would look like it had worked.
  const errors = validateTransaction({ ...valid, method: 'Coral', category: 'Coral' }, TODAY);
  assert.match(errors?.['method'] ?? '', /cannot be paid from Coral itself/);

  // Paying one card from another is legitimate and must still pass.
  assert.equal(validateTransaction({ ...valid, method: 'Edge', category: 'Coral' }, TODAY), null);
});

test('remarks are length-bounded', () => {
  assert.equal(validateTransaction({ ...valid, remarks: 'x'.repeat(MAX_REMARKS) }, TODAY), null);
  assert.ok(validateTransaction({ ...valid, remarks: 'x'.repeat(MAX_REMARKS + 1) }, TODAY)?.['remarks']);
});

/* --- Duplicate prevention ------------------------------------------------ */

test('the same idempotency key always yields the same row id', async () => {
  const a = await idFromKey('abc-123');
  const b = await idFromKey('abc-123');
  assert.equal(a, b, 'a retried submission must resolve to the same row');
  assert.match(a, /^tx-[0-9a-f]{24}$/);

  const other = await idFromKey('abc-124');
  assert.notEqual(a, other, 'a different submission must be a different row');
});

test('two identical entries with different keys stay two entries', async () => {
  // This is deliberate. The live data contains a genuine pair of identical
  // ₹10 rows on one day; collapsing entries by content would erase one.
  const first = await idFromKey('key-one');
  const second = await idFromKey('key-two');
  assert.notEqual(first, second);
});

/* --- Derived fields ------------------------------------------------------ */

test('derived fields are computed server-side, never taken from the caller', () => {
  const row = buildRow(valid, 'tx-test', 'app');
  assert.equal(row.kind, 'spend');
  assert.equal(row.card_affected, 'Coral');
  assert.equal(row.card_direction, 'debt+');
  // A new entry cannot claim to be reconciled already.
  assert.equal(row.verified, false);
  assert.equal(row.deleted, false);
});

test('a bill payment derives the opposite direction', () => {
  const row = buildRow({ ...valid, method: 'Fi', category: 'Coral', remarks: 'Bill' }, 'tx-x', 'app');
  assert.equal(row.kind, 'card_payment');
  assert.equal(row.card_affected, 'Coral');
  assert.equal(row.card_direction, 'debt-');
});

test('the stored amount is exact at the paisa', () => {
  assert.equal(buildRow({ ...valid, amount: '1,234.56' }, 'tx-a', 'app').amount, 1234.56);
  assert.equal(buildRow({ ...valid, amount: '₹0.05' }, 'tx-b', 'app').amount, 0.05);
  assert.equal(buildRow({ ...valid, amount: 99 }, 'tx-c', 'app').amount, 99);
});

test('buildRow refuses to run on an unvalidated amount', () => {
  // Belt and braces: validation gates this, but a future caller that forgets
  // must fail loudly rather than write NaN into a ledger.
  assert.throws(() => buildRow({ ...valid, amount: 'nonsense' }, 'tx-d', 'app'), /unvalidated/);
});

test('the row shape matches the Postgres columns exactly', () => {
  const row = buildRow(valid, 'tx-shape', 'app');
  const expected = [
    'id', 'ts', 'amount', 'method', 'category', 'remarks', 'kind',
    'card_affected', 'card_direction', 'tags', 'verified', 'needs_review',
    'deleted', 'source',
  ].sort();
  assert.deepEqual(Object.keys(row).sort(), expected);
  // camelCase must never reach the database.
  assert.ok(!('cardAffected' in row));
  assert.ok(!('needsReview' in row));
});

/* --- Income -------------------------------------------------------------- */

test('income validation mirrors the transaction rules', () => {
  const good = { amount: '5000', source: 'Salary', account: 'Fi', ts: '2026-08-01T10:00:00' };
  assert.equal(validateIncome(good, TODAY), null);

  assert.ok(validateIncome({ ...good, amount: '-1' }, TODAY)?.['amount']);
  assert.ok(validateIncome({ ...good, amount: '1.234' }, TODAY)?.['amount']);
  assert.ok(validateIncome({ ...good, source: '' }, TODAY)?.['source']);
  assert.ok(validateIncome({ ...good, account: '' }, TODAY)?.['account']);
  assert.ok(validateIncome({ ...good, ts: '2026-02-31T10:00:00' }, TODAY)?.['ts']);
});
