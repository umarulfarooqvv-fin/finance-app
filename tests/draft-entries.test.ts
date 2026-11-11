import { describe, expect, it } from 'vitest';
import { draftEntries, findTwin, gapErrors, needingDetail } from '@/lib/draft-entries';
import { withoutRow } from '@/lib/capture-drafts';
import type { Transaction } from '@/lib/types';

const TAKEN = '2026-09-25T13:54:26';
const PHOTO = { id: 'p1', ts: TAKEN, bytes: 1000 };
const TWO = [
  '25/09/2026 | 380 | RBL | Medicine | Arafa Medical',
  '25/09/2026 | 120 | RBL |  | Parking',
].join('\n');

const tx = (amount: number, ts: string, remarks = 'Arafa'): Transaction => ({
  id: 't', ts, amount, method: 'RBL', category: 'Medicine', remarks, userTags: [], kind: 'spend',
  cardAffected: null, cardDirection: null, tags: {}, verified: false, needsReview: false, deleted: false, source: 'app',
} as Transaction);

describe('drafts on Entries', () => {
  it('one draft per row read, dated like the inbox form, gaps flagged', () => {
    const d = draftEntries([PHOTO], { p1: { text: TWO } }, {}, []);
    expect(d).toHaveLength(2);
    expect(d.find((x) => x.amount === 380)).toMatchObject({ ts: TAKEN, complete: true, remarks: 'Arafa Medical', captureId: 'p1' });
    expect(d.find((x) => x.amount === 120)).toMatchObject({ complete: false, category: '' });
  });

  it('hides rows put away, and photos with no reading', () => {
    const raw = '25/09/2026 | 120 | RBL |  | Parking';
    expect(draftEntries([PHOTO], { p1: { text: TWO, hidden: [raw] } }, {}, [])).toHaveLength(1);
    expect(draftEntries([PHOTO], {}, {}, [])).toHaveLength(0);
  });

  it('flags an entry already on file the same day for the same amount', () => {
    const d = draftEntries([PHOTO], { p1: { text: TWO } }, {}, [tx(380, '2026-09-25T09:00:00')]);
    expect(d.find((x) => x.amount === 380)!.duplicateOf).toMatchObject({ remarks: 'Arafa', amount: 380 });
    expect(d.find((x) => x.amount === 120)!.duplicateOf).toBeNull();
  });

  it('cutting an added row out of the reading leaves the rest', () => {
    expect(withoutRow(TWO, '25/09/2026 | 380 | RBL | Medicine | Arafa Medical')).toBe('25/09/2026 | 120 | RBL |  | Parking');
  });
});

/* What becomes an entry without being asked, and what is held for a person.
   The owner's rule: the same amount at the same time on the same card is the
   same payment, and is never added twice. */
describe('adding drafts without being asked', () => {
  const photo = (id: string, ts: string) => ({ id, ts, bytes: 1 });
  const one = (text: string, txs: Transaction[] = [], ts = '2026-11-10T21:51:36') =>
    draftEntries([photo('p', ts)], { p: { text } }, {}, txs, {}, '2026-11-11')[0]!;
  const entry = (over: Partial<Transaction>): Transaction => ({ ...tx(202, '2026-11-10T21:53:10', 'K K Bakery'), method: 'Scapia', category: 'Food', ...over } as Transaction);

  it('a complete reading with nothing like it on file is added', () => {
    expect(one('10/11/2026 21:51 | 202 | Scapia | Food | K K Bakery Coolbar').auto).toEqual({ add: true, missing: [] });
  });

  it('a missing category or payment does not stop it — the gap is asked for afterwards', () => {
    expect(one('10/11/2026 15:22 | 2800 | Fi |  | Muhammed Suhail').auto).toEqual({ add: true, missing: ['category'] });
    expect(one('10/11/2026 21:26 | 10 |  | Food | Hotel Soorya Bhavan').auto).toEqual({ add: true, missing: ['method'] });
  });

  it('the same amount, moment and card already on file is a duplicate, not added', () => {
    const d = one('10/11/2026 21:51 | 202 | Scapia | Food | K K Bakery Coolbar', [entry({ id: 'e1' })]);
    expect(d.auto).toEqual({ add: false, why: 'duplicate' });
    expect(d.duplicateOf).toMatchObject({ id: 'e1', sure: true });
  });

  it('an entry typed in later sits at noon: the same day and name is still the same payment', () => {
    const d = one('10/11/2026 21:51 | 202 |  | Food | K K Bakery Coolbar', [entry({ ts: '2026-11-10T12:00:00', remarks: 'K K bakery' })]);
    expect(d.auto).toEqual({ add: false, why: 'duplicate' });
  });

  it('the same amount that day on another card, or hours apart, is a question — not added', () => {
    const otherCard = one('10/11/2026 21:51 | 202 | Scapia | Food | K K Bakery', [entry({ method: 'Fi' })]);
    expect(otherCard.auto).toEqual({ add: false, why: 'maybe-duplicate' });
    const hoursApart = one('10/11/2026 21:51 | 202 | Scapia | Food | K K Bakery', [entry({ ts: '2026-11-10T16:53:00', remarks: 'Office tea' })]);
    expect(hoursApart.auto).toEqual({ add: false, why: 'maybe-duplicate' });
    expect(hoursApart.duplicateOf!.sure).toBe(false);
  });

  it('the same amount on another day is a different payment', () => {
    expect(one('10/11/2026 21:51 | 202 | Scapia | Food | K K Bakery', [entry({ ts: '2026-11-09T21:51:00' })]).auto.add).toBe(true);
  });

  it('a deleted entry is not a twin', () => {
    expect(one('10/11/2026 21:51 | 202 | Scapia | Food | K K Bakery', [entry({ deleted: true })]).auto.add).toBe(true);
  });

  it('two photos of one payment become one entry: the second is the first one\u2019s duplicate', () => {
    const row = '04/11/2026 22:31 | 1236 | Scapia | Groceries | Hyper Budget Super Market';
    const d = draftEntries(
      [photo('a', '2026-11-04T22:32:14'), photo('b', '2026-11-04T22:32:06')],
      { a: { text: row }, b: { text: row } }, {}, [], {}, '2026-11-11',
    );
    expect(d.filter((x) => x.auto.add)).toHaveLength(1);
    expect(d.find((x) => !x.auto.add)!.auto).toEqual({ add: false, why: 'duplicate' });
  });

  it('a date that could not be trusted is held: it would be filed, and checked, on the wrong day', () => {
    const d = one('23/09/2026 | 30000.00 | Fi |  | EMS Discharge', [], '2026-11-08T17:35:38');
    expect(d.auto).toEqual({ add: false, why: 'date' });
  });

  it('the prompt\u2019s own example date, copied out by the model, is not a date read', () => {
    const d = one('22/09/2026 15:11 | 100 | Fi | Food | Zomato', [], '2026-10-30T13:44:28');
    expect(d.auto).toEqual({ add: false, why: 'date' });
    expect(d.dateNote).toMatch(/example/);
  });

  it('neither what paid nor what for: not recognisably a payment', () => {
    expect(one('10/11/2026 15:11 | 4716014 |  |  | Total spent').auto).toEqual({ add: false, why: 'unreadable' });
  });

  it('a row the ledger would refuse is held, not attempted', () => {
    // A card cannot pay its own bill — the entry form refuses this pair too.
    expect(one('10/11/2026 15:11 | 500 | Scapia | Scapia | Bill').auto).toEqual({ add: false, why: 'unreadable' });
  });

  it('findTwin prefers the certain match over a nearer maybe', () => {
    const twin = findTwin(
      { ts: '2026-11-10T21:51:00', timed: true, amount: 70, method: 'Scapia', remarks: 'Salih' },
      [
        { id: 'far', ts: '2026-11-10T21:50:00', amount: 70, method: 'Fi', remarks: 'Tea' },
        { id: 'same', ts: '2026-11-10T21:56:00', amount: 70, method: 'Scapia', remarks: 'Salih M' },
      ],
    );
    expect(twin).toMatchObject({ id: 'same', sure: true });
  });

  it('forgives only a BLANK payment or category', () => {
    const base = { amount: 10, ts: '2026-11-10T21:26:00', remarks: 'x' };
    expect(gapErrors({ ...base, method: '', category: '' }, '2026-11-11')).toBeNull();
    expect(gapErrors({ ...base, method: 'Paytm', category: '' }, '2026-11-11')).toHaveProperty('method');
    expect(gapErrors({ ...base, method: 'Fi', category: 'Foood' }, '2026-11-11')).toHaveProperty('category');
    expect(gapErrors({ ...base, amount: null, method: 'Fi', category: 'Food' }, '2026-11-11')).toHaveProperty('amount');
  });

  it('lists entries made from photos that still lack a detail', () => {
    const list = needingDetail([
      entry({ id: 'a', source: 'photo', category: '' }),
      entry({ id: 'b', source: 'photo' }),
      entry({ id: 'c', source: 'app', category: '' }),
      entry({ id: 'd', source: 'photo', method: '', deleted: true }),
    ], 'photo');
    expect(list.map((t) => t.id)).toEqual(['a']);
  });
});

