import assert from 'node:assert/strict';
import { test } from 'vitest';
import { entryFromReading } from '@/lib/capture-entry';

/* ===========================================================================
   Filling the entry form from a photo's reading.

   The inbox's Entry button used to open a blank form beside a photo whose
   rows had already been read. These pin down what it fills, and — the part
   that needs judgement — which date it trusts.
   =========================================================================== */

// A photo taken on the afternoon of 25 September 2026.
const TAKEN = '2026-09-25T13:54:26';

test('a one-row reading fills every field it could settle', () => {
  const r = entryFromReading('25/09/2026 | 380 | RBL | Medicine | Arafa Medical', TAKEN);
  assert.equal(r.kind, 'one');
  if (r.kind !== 'one') return;
  assert.deepEqual(r.draft, {
    ts: TAKEN, amount: 380, method: 'RBL', category: 'Medicine', remarks: 'Arafa Medical',
  });
});

test('same day as the photo keeps the photo’s own time', () => {
  const r = entryFromReading('25/09/2026 | 380 | RBL | Medicine | Arafa Medical', TAKEN);
  assert.equal(r.kind === 'one' && r.draft.ts, TAKEN, 'the moment of the photo, not noon');
  assert.equal(r.kind === 'one' && r.datedByReading, false);
});

test('a screenshot of an earlier payment is dated as it shows, at noon', () => {
  // A UPI confirmation from Monday, looked at on Friday.
  const r = entryFromReading('22/09/2026 | 200 | RBL | Food | Canteen', TAKEN);
  assert.equal(r.kind, 'one');
  if (r.kind !== 'one') return;
  assert.equal(r.draft.ts, '2026-09-22T12:00:00');
  assert.equal(r.datedByReading, true);
  assert.equal(r.dateDoubtful, false);
});

test('a year the model invented is replaced, keeping the day it read — the case that prompted this', () => {
  // The screen said "September 22" with no year; the model wrote 2025 for a
  // photo taken in 2026. Believed, it would file the entry into a statement
  // paid a year ago. The day and month are real; only the year was made up.
  const r = entryFromReading('22/09/2025 | 380 | RBL | Medicine | Arafa Medical', TAKEN);
  assert.equal(r.kind, 'one');
  if (r.kind !== 'one') return;
  assert.equal(r.draft.ts, '2026-09-22T12:00:00');
  assert.equal(r.yearCorrected, true, 'and says so, so the form can tell the person');
  assert.equal(r.dateDoubtful, false);
});

test('a December payment photographed in January keeps last year', () => {
  const r = entryFromReading('28/12/2031 | 90 | Cash | Food | Tea', '2027-01-03T10:00:00');
  assert.equal(r.kind === 'one' && r.draft.ts, '2026-12-28T12:00:00');
});

test('a date no year can rescue is not believed, and the photo\u2019s own time is kept', () => {
  const r = entryFromReading('02/03/2026 | 380 | RBL | Medicine | Old bill', TAKEN);
  assert.equal(r.kind, 'one');
  if (r.kind !== 'one') return;
  assert.equal(r.draft.ts, TAKEN);
  assert.equal(r.dateDoubtful, true);
  assert.equal(r.draft.amount, 380, 'the rest of the reading still fills in');
});

test('a date after the photo was taken is not believed either', () => {
  const r = entryFromReading('26/09/2026 | 50 | RBL | Food | Tea', TAKEN);
  assert.equal(r.kind === 'one' && r.draft.ts, TAKEN);
  assert.equal(r.kind === 'one' && r.dateDoubtful, true);
});

test('a field the reading could not settle is left for the person, not guessed', () => {
  const r = entryFromReading('25/09/2026 | 380 | Some Wallet | UNREADABLE | Arafa Medical', TAKEN);
  assert.equal(r.kind, 'one');
  if (r.kind !== 'one') return;
  assert.equal(r.draft.method, undefined, 'an unknown method stays empty');
  assert.equal(r.draft.category, undefined, 'an unreadable category stays empty');
  assert.equal(r.draft.amount, 380);
});

test('a bank’s own label fills Paid from with this ledger’s name for it', () => {
  const r = entryFromReading(
    '25/09/2026 | 1580 | Federal 2788 | Medicine | Hospital',
    TAKEN,
    { 'Federal 2788': 'Fi' },
  );
  assert.equal(r.kind === 'one' && r.draft.method, 'Fi');
});

test('a photo with several rows fills nothing — one form cannot hold three entries', () => {
  const r = entryFromReading(
    [
      '25/09/2026 | 450 | Fi | Food | Hospital canteen',
      '25/09/2026 | 1250 | Fi | Medicine | Pharmacy',
      '25/09/2026 | 300 | Cash | Family | Parking',
    ].join('\n'),
    TAKEN,
  );
  assert.deepEqual(r, { kind: 'several', rows: 3 });
});

test('a reading with no usable row fills nothing', () => {
  assert.deepEqual(entryFromReading('I could not find any payments in this image.', TAKEN), { kind: 'none' });
  assert.deepEqual(entryFromReading('', TAKEN), { kind: 'none' });
});

test('the time printed on the screen is used, not noon or the photo\u2019s moment', () => {
  // "September 22 at 3:11 PM", photographed three days later.
  const r = entryFromReading('22/09/2026 15:11 | 380 | RBL | Medicine | Arafa Medical', TAKEN);
  assert.equal(r.kind === 'one' && r.draft.ts, '2026-09-22T15:11:00');
  // Same day as the photo, with a time of its own: the payment's time wins.
  const same = entryFromReading('25/09/2026 09:02 | 50 | Cash | Food | Tea', TAKEN);
  assert.equal(same.kind === 'one' && same.draft.ts, '2026-09-25T09:02:00');
});

test('a time on a date that could not be trusted is dropped along with it', () => {
  const r = entryFromReading('02/03/2026 15:11 | 380 | RBL | Medicine | Old bill', TAKEN);
  assert.equal(r.kind === 'one' && r.draft.ts, TAKEN);
});
