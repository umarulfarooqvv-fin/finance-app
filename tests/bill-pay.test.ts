import { describe, expect, it } from 'vitest';
import { billPayers, billRemarks } from '@/lib/bill-pay';
import { classify } from '@/lib/classify';
import { ALL_METHODS } from '@/lib/types';
import type { Transaction } from '@/lib/types';

const pay = (id: string, method: string, card: string, ts: string, deleted = false): Transaction => ({
  id, ts, amount: 100, method, category: card, remarks: billRemarks(card), userTags: [],
  kind: 'card_payment', cardAffected: card, cardDirection: 'debt-', tags: {}, verified: false,
  needsReview: false, deleted, source: 'app',
} as Transaction);

describe('marking a card bill as paid', () => {
  it('offers the account this card was paid from last, first', () => {
    const list = billPayers([
      pay('a', 'Fi', 'Scapia', '2026-09-01T10:00:00'),
      pay('b', 'Jupiter', 'Scapia', '2026-10-01T10:00:00'),
      pay('c', 'Perks', 'Scapia', '2026-11-01T10:00:00', true),
      pay('d', 'SBI', 'Coral', '2026-11-02T10:00:00'),
    ], 'Scapia');
    expect(list.slice(0, 2)).toEqual(['Jupiter', 'Fi']);
  });

  it('never offers the card itself, and still offers every other account', () => {
    const list = billPayers([], 'Scapia');
    expect(list).not.toContain('Scapia');
    expect(list).toHaveLength(ALL_METHODS.length - 1);
  });

  it('what it saves is read as a payment on that card', () => {
    const c = classify({ method: 'Fi', category: 'Scapia', remarks: billRemarks("Scapia") });
    expect(c).toMatchObject({ kind: 'card_payment', cardAffected: 'Scapia', cardDirection: 'debt-' });
  });
});
