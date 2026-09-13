import assert from 'node:assert/strict';
import { test } from 'vitest';
import { creditLedger } from '@/lib/credit';
import { makeSnapshot, tx, income } from './helpers';

/* ===========================================================================
   Money coming back.

   The ledger has always guessed the debtor by looking for a known name in the
   text. That works when the remark says "Ashiq for scooty repairs" and fails
   silently when it says "Visiting card aquafenix" — the repayment attaches to
   nobody, settles nothing, and the lending reads as outstanding for ever.

   These cover the explicit mapping that overrides the guess, and the list of
   repayments that matched nobody, which is the thing that makes the failure
   visible instead of invisible.
   =========================================================================== */

const lend = (person: string, amount: number, ts: string) =>
  tx({ ts, amount, method: 'Fi', category: 'Credit Given', remarks: person });

const back = (text: string, amount: number, ts: string, id?: string) =>
  income({ ts, amount, source: 'Credit Return', remarks: text, ...(id ? { id } : {}) });

test('a repayment naming the debtor settles the oldest lending first', () => {
  const snap = makeSnapshot({
    transactions: [lend('Ashiq', 1000, '2026-01-05T10:00:00'), lend('Ashiq', 500, '2026-02-05T10:00:00')],
    income: [back('Ashiq paid back', 1200, '2026-03-01T10:00:00')],
  });
  const led = creditLedger(snap);
  const ashiq = led.people.find((p) => p.person === 'Ashiq');
  assert.equal(ashiq?.given, 1500);
  assert.equal(ashiq?.repaid, 1200);
  assert.equal(ashiq?.outstanding, 300);
  assert.equal(ashiq?.lendings[0]?.outstanding, 0, 'the January lending is cleared first');
  assert.equal(ashiq?.lendings[1]?.outstanding, 300);
  assert.equal(led.unattached.length, 0);
});

test('a repayment naming nobody is reported, not silently dropped', () => {
  const snap = makeSnapshot({
    transactions: [lend('Ashiq', 1000, '2026-01-05T10:00:00')],
    income: [back('Visiting card aquafenix', 480, '2026-03-01T10:00:00', 'inc-x')],
  });
  const led = creditLedger(snap);
  assert.equal(led.totalRepaid, 0, 'it settles nothing, because nobody owns it');
  assert.equal(led.unattached.length, 1);
  assert.equal(led.unattached[0]?.id, 'inc-x');
  assert.equal(led.unattached[0]?.amount, 480);
});

test('an explicit mapping attaches a repayment the text could never match', () => {
  const snap = makeSnapshot({
    transactions: [lend('Ashiq', 1000, '2026-01-05T10:00:00')],
    income: [back('Visiting card aquafenix', 480, '2026-03-01T10:00:00', 'inc-x')],
    config: { credit_status: { assignRepayment: { 'inc-x': 'Ashiq' } } },
  });
  const led = creditLedger(snap);
  const ashiq = led.people.find((p) => p.person === 'Ashiq');
  assert.equal(ashiq?.repaid, 480);
  assert.equal(ashiq?.outstanding, 520);
  assert.equal(led.unattached.length, 0);
});

test('an explicit mapping overrides the name the text would have matched', () => {
  // The remark says Ashiq, but the money actually came from Irshad. What was
  // recorded by hand has to beat what the text implies.
  const snap = makeSnapshot({
    transactions: [lend('Ashiq', 5000, '2026-01-05T10:00:00'), lend('Irshad', 900, '2026-01-06T10:00:00')],
    income: [back('Ashiq handed it over', 900, '2026-04-03T10:00:00', 'inc-y')],
    config: { credit_status: { assignRepayment: { 'inc-y': 'Irshad' } } },
  });
  const led = creditLedger(snap);
  assert.equal(led.people.find((p) => p.person === 'Irshad')?.repaid, 900);
  assert.equal(led.people.find((p) => p.person === 'Ashiq')?.repaid, 0);
  assert.equal(led.people.find((p) => p.person === 'Ashiq')?.outstanding, 5000);
});

test('names one edit apart are still merged, mapping or not', () => {
  /* Documenting a limitation rather than a feature. groupKey folds "Faris"
     into "Fayis" because they are one character apart, and that happens AFTER
     a repayment is attributed — so assigning one by hand picks the name but
     cannot force the two apart. Over-merging is the ledger's deliberate
     choice: one person scattered over six spellings is invisible, whereas two
     people sharing a group is visible on the page. Splitting them needs a
     separate mechanism, which does not exist yet. */
  const snap = makeSnapshot({
    transactions: [lend('Fayis', 5000, '2026-01-05T10:00:00'), lend('Faris', 200, '2026-01-06T10:00:00')],
    income: [back('Faris for Chapathi', 10, '2026-04-03T10:00:00', 'inc-y')],
    config: { credit_status: { assignRepayment: { 'inc-y': 'Faris' } } },
  });
  const led = creditLedger(snap);
  const merged = led.people.filter((p) => /fa[yr]is/i.test(p.person));
  assert.equal(merged.length, 1, 'they share one ledger');
  assert.equal(merged[0]?.given, 5200);
  assert.equal(merged[0]?.repaid, 10);
});

test('an empty mapping says "this is not a repayment at all"', () => {
  // A row can mention "settle" and be nothing of the kind. Marking it excluded
  // must not fall through to the guess.
  const snap = makeSnapshot({
    transactions: [lend('Ashiq', 1000, '2026-01-05T10:00:00')],
    income: [back('Ashiq settle up dinner - my treat', 400, '2026-03-01T10:00:00', 'inc-z')],
    config: { credit_status: { assignRepayment: { 'inc-z': '' } } },
  });
  const led = creditLedger(snap);
  assert.equal(led.totalRepaid, 0);
  assert.equal(led.unattached.length, 0, 'excluded on purpose, so not outstanding work');
  assert.equal(led.people.find((p) => p.person === 'Ashiq')?.outstanding, 1000);
});

test('an explicit mapping works on an entry that does not read as a repayment', () => {
  // Income filed as "Freelance" that was really a friend paying you back.
  const snap = makeSnapshot({
    transactions: [lend('Ashiq', 1000, '2026-01-05T10:00:00')],
    income: [income({ ts: '2026-03-01T10:00:00', amount: 600, source: 'Freelance', remarks: 'transfer', id: 'inc-w' })],
    config: { credit_status: { assignRepayment: { 'inc-w': 'Ashiq' } } },
  });
  const led = creditLedger(snap);
  assert.equal(led.people.find((p) => p.person === 'Ashiq')?.repaid, 600);
});

test('repaying more than was lent leaves nothing owed, never a debt the other way', () => {
  const snap = makeSnapshot({
    transactions: [lend('Ashiq', 1000, '2026-01-05T10:00:00')],
    income: [back('Ashiq', 1500, '2026-03-01T10:00:00')],
  });
  const led = creditLedger(snap);
  const ashiq = led.people.find((p) => p.person === 'Ashiq');
  assert.equal(ashiq?.outstanding, 0);
  assert.equal(ashiq?.settled, true);
});

test('the outstanding figure the statement excludes follows the repayment', () => {
  // Excluding credit given means the part of the CURRENT balance that was lent
  // and has not come back. Once it comes back there is nothing to exclude.
  const snap = makeSnapshot({
    transactions: [tx({ ts: '2026-01-05T10:00:00', amount: 1000, method: 'Coral', category: 'Credit Given', remarks: 'Ashiq' })],
    income: [back('Ashiq', 1000, '2026-03-01T10:00:00')],
  });
  const led = creditLedger(snap);
  assert.equal(led.outstandingByCard['Coral'] ?? 0, 0);
  assert.equal(Object.values(led.outstandingByTx)[0], 0);
});
