import assert from 'node:assert/strict';
import { test } from 'vitest';
import { photoVerdict, type EntryFacts, type OtherEntry } from '@/lib/photo-method';

/* ===========================================================================
   What an entry's attached photo is allowed to change.

   The one place a model's reading changes an entry rather than proposing one,
   so these pin every condition — and the duplicate check that stops it
   changing anything when the photo points at a payment already logged.
   =========================================================================== */

const MAPPING = { 'Federal 2788': 'Fi', 'Federal 3838': 'Jupiter', 'Federal XX16': 'Scapia' };

// "Car for hospital uppa", logged as Fi at 10:05 PM for a 5:44 PM payment.
const ENTRY: EntryFacts = {
  ts: '2026-09-26T22:05:00', amount: 500, method: 'Fi', verified: false,
  category: 'Fuel', remarks: 'Car for hospital uppa',
};
const PHOTO = '26/09/2026 17:44 | 500 | Federal CC XX16 | Fuel | Pmr Petroleum 1';

const other = (o: Partial<OtherEntry>): OtherEntry => ({
  id: 'tx-other', ts: '2026-09-26T17:44:00', amount: 500, method: 'Scapia',
  category: 'Food', remarks: 'Something else', ...o,
});

/* ---- the card ------------------------------------------------------------ */

test('the case that prompted it: card and time both corrected from the screenshot', () => {
  assert.deepEqual(photoVerdict(PHOTO, ENTRY, MAPPING), {
    kind: 'apply',
    proposal: {
      method: { to: 'Scapia', label: 'Federal CC XX16' },
      ts: { to: '2026-09-26T17:44:00' },
    },
  });
});

test('a card NAME written by the model is never acted on — only a printed bank label', () => {
  // This is how "RBL" once appeared for a Federal card. The time still moves.
  const v = photoVerdict(PHOTO.replace('Federal CC XX16', 'Scapia'), ENTRY, MAPPING);
  assert.equal(v.kind === 'apply' && v.proposal.method, undefined);
});

test('a label without an account number, or one the mapping does not know, moves no card', () => {
  for (const label of ['Federal Bank', 'HDFC XX99']) {
    const v = photoVerdict(PHOTO.replace('Federal CC XX16', label), ENTRY, MAPPING);
    assert.equal(v.kind === 'apply' && v.proposal.method, undefined, label);
  }
});

/* ---- the time ------------------------------------------------------------ */

test('a payment made days before it was logged is moved to that day and time', () => {
  const v = photoVerdict(PHOTO.replace('26/09/2026 17:44', '22/09/2026 15:11'), ENTRY, MAPPING);
  assert.equal(v.kind === 'apply' && v.proposal.ts?.to, '2026-09-22T15:11:00');
});

test('logged a couple of minutes after paying is not an error', () => {
  const v = photoVerdict(PHOTO, { ...ENTRY, method: 'Scapia', ts: '2026-09-26T17:46:30' }, MAPPING);
  assert.deepEqual(v, { kind: 'keep', reason: 'already right' });
});

test('a photo with a date but no time moves only a wrong DAY, to noon', () => {
  const v = photoVerdict('24/09/2026 | 500 | Federal CC XX16 | Fuel | Petrol', { ...ENTRY, method: 'Scapia' }, MAPPING);
  assert.equal(v.kind === 'apply' && v.proposal.ts?.to, '2026-09-24T12:00:00');
});

test('a date that cannot be trusted changes nothing at all', () => {
  // After the entry was logged, or implausibly old: not proof of this payment.
  for (const d of ['28/09/2026 10:00', '01/03/2026 10:00']) {
    assert.equal(photoVerdict(PHOTO.replace('26/09/2026 17:44', d), ENTRY, MAPPING).kind, 'keep', d);
  }
});

/* ---- when nothing may change ---------------------------------------------- */

test('a different amount means it may be a different payment', () => {
  assert.equal(photoVerdict(PHOTO, { ...ENTRY, amount: 50 }, MAPPING).kind, 'keep');
  assert.equal(photoVerdict(PHOTO, { ...ENTRY, amount: 500.01 }, MAPPING).kind, 'keep', 'to the paisa');
});

test('a statement-reconciled entry is left alone — the statement outranks a screenshot', () => {
  assert.equal(photoVerdict(PHOTO, { ...ENTRY, verified: true }, MAPPING).kind, 'keep');
});

test('a photo of several payments, or an unreadable one, changes nothing', () => {
  assert.equal(photoVerdict(`${PHOTO}\n${PHOTO}`, ENTRY, MAPPING).kind, 'keep');
  assert.equal(photoVerdict('I could not read this image.', ENTRY, MAPPING).kind, 'keep');
});

/* ---- duplicates ------------------------------------------------------------ */

test('the same amount on the same card that day: ask, change nothing', () => {
  const v = photoVerdict(PHOTO, ENTRY, MAPPING, [other({ method: 'Scapia' })]);
  assert.equal(v.kind, 'ask');
  if (v.kind !== 'ask') return;
  assert.equal(v.duplicate.id, 'tx-other');
  assert.match(v.why, /Scapia/, 'compared against the CORRECTED card');
  assert.ok(v.proposal.ts && v.proposal.method, 'and what would change is kept for "not a duplicate"');
});

test('the same amount with the same category, or a shared word, also asks', () => {
  assert.match(
    (photoVerdict(PHOTO, ENTRY, MAPPING, [other({ method: 'Cash', category: 'Fuel' })]) as { why: string }).why,
    /category/,
  );
  assert.match(
    (photoVerdict(PHOTO, ENTRY, MAPPING, [other({ method: 'Cash', remarks: 'Hospital trip taxi' })]) as { why: string }).why,
    /hospital/,
  );
});

test('the same amount alone is not a duplicate — ₹500 is a common number', () => {
  const v = photoVerdict(PHOTO, ENTRY, MAPPING, [other({ method: 'Cash', category: 'Food', remarks: 'Groceries' })]);
  assert.equal(v.kind, 'apply');
});

test('a look-alike on a different day is not a duplicate of this payment', () => {
  const v = photoVerdict(PHOTO, ENTRY, MAPPING, [other({ ts: '2026-09-20T17:44:00', method: 'Scapia' })]);
  assert.equal(v.kind, 'apply');
});

test('the Add Spend double-post shape: an uncategorised twin at the same time is caught', () => {
  const v = photoVerdict(
    PHOTO,
    { ...ENTRY, method: 'Scapia', ts: '2026-09-26T17:44:30' },
    MAPPING,
    [other({ ts: '2026-09-26T17:44:28', method: 'Scapia', category: '', remarks: 'Car for hospital uppa' })],
  );
  assert.equal(v.kind, 'ask');
});

/* ---- one Undo for everything a photo changed ---------------------------- */

test('a later correction keeps the ORIGINAL values, so one Undo restores both', async () => {
  const { mergeCorrection } = await import('@/lib/photo-check');
  const base = { transactionId: 't', captureId: 'c', amount: 500, remarks: 'Car', at: 'x' };
  const cardFirst = { ...base, ts: '2026-09-26T22:05:58', method: { from: 'Fi', to: 'Scapia', label: 'Federal CC XX16' } };
  const timeLater = { ...base, ts: '2026-09-26T22:05:58', time: { from: '2026-09-26T22:05:58', to: '2026-09-26T17:44:00' } };

  const merged = mergeCorrection(cardFirst, timeLater);
  assert.deepEqual(merged.method, cardFirst.method, 'the card change survives');
  assert.deepEqual(merged.time, timeLater.time);

  // The same field corrected twice keeps where it STARTED, not the middle.
  const again = mergeCorrection(merged, { ...base, ts: 'x', method: { from: 'Scapia', to: 'Jupiter', label: 'Federal 3838' } });
  assert.equal(again.method?.from, 'Fi');
  assert.equal(again.method?.to, 'Jupiter');
  assert.equal(mergeCorrection(undefined, timeLater), timeLater);
});
