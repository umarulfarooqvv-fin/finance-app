import assert from 'node:assert/strict';
import { test } from 'vitest';
import { methodFromPhoto, type EntryFacts } from '@/lib/photo-method';

/* ===========================================================================
   Moving an entry to the card its attached photo shows.

   The one place a model's reading changes an entry rather than proposing one,
   so these pin every condition: the correction happens only when the photo is
   certainly OF this payment and certainly NAMES a card the ledger knows.
   =========================================================================== */

const MAPPING = { 'Federal 2788': 'Fi', 'Federal 3838': 'Jupiter', 'Federal XX16': 'Scapia' };

// "Car for hospital uppa", logged as Fi at 22:05 for a 5:44 PM payment.
const ENTRY: EntryFacts = { ts: '2026-09-26T22:05:00', amount: 500, method: 'Fi', verified: false };
const PHOTO = '26/09/2026 17:44 | 500 | Federal CC XX16 | Fuel | Pmr Petroleum 1';

test('the case that prompted it: logged as Fi, the screenshot says Federal CC XX16', () => {
  assert.deepEqual(methodFromPhoto(PHOTO, ENTRY, MAPPING), { kind: 'correct', to: 'Scapia', label: 'Federal CC XX16' });
});

test('already on the right card: nothing to do', () => {
  assert.equal(methodFromPhoto(PHOTO, { ...ENTRY, method: 'Scapia' }, MAPPING).kind, 'keep');
});

test('a different amount means it may be a different payment', () => {
  const v = methodFromPhoto(PHOTO, { ...ENTRY, amount: 50 }, MAPPING);
  assert.equal(v.kind, 'keep');
  assert.match(v.kind === 'keep' ? v.reason : '', /amount/);
  // To the paisa, not "close enough".
  assert.equal(methodFromPhoto(PHOTO, { ...ENTRY, amount: 500.01 }, MAPPING).kind, 'keep');
});

test('a statement-reconciled entry is left alone — the statement outranks a screenshot', () => {
  const v = methodFromPhoto(PHOTO, { ...ENTRY, verified: true }, MAPPING);
  assert.equal(v.kind, 'keep');
});

test('a photo from another day is not this payment', () => {
  assert.equal(methodFromPhoto(PHOTO.replace('26/09/2026', '20/09/2026'), ENTRY, MAPPING).kind, 'keep');
  // Logged just after midnight for last night's payment: the day before is fine.
  assert.equal(methodFromPhoto(PHOTO.replace('26/09/2026', '25/09/2026'), ENTRY, MAPPING).kind, 'correct');
});

test('a card NAME written by the model is never acted on — only a printed bank label', () => {
  // This is how "RBL" once appeared for a Federal card.
  const v = methodFromPhoto('26/09/2026 17:44 | 500 | Scapia | Fuel | Pmr Petroleum 1', ENTRY, MAPPING);
  assert.equal(v.kind, 'keep');
});

test('a label with no account number, or one the mapping does not know, is left alone', () => {
  assert.equal(methodFromPhoto(PHOTO.replace('Federal CC XX16', 'Federal Bank'), ENTRY, MAPPING).kind, 'keep');
  assert.equal(methodFromPhoto(PHOTO.replace('Federal CC XX16', 'HDFC XX99'), ENTRY, MAPPING).kind, 'keep');
});

test('a photo of several payments is not a photo of this one', () => {
  const two = `${PHOTO}\n26/09/2026 17:50 | 500 | Federal CC XX16 | Fuel | Again`;
  assert.equal(methodFromPhoto(two, ENTRY, MAPPING).kind, 'keep');
});

test('an unreadable reading changes nothing', () => {
  assert.equal(methodFromPhoto('I could not read this image.', ENTRY, MAPPING).kind, 'keep');
});
