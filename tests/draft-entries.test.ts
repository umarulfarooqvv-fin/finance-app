import { describe, expect, it } from 'vitest';
import { draftEntries } from '@/lib/draft-entries';
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
