import { describe, expect, it } from 'vitest';
import { cardCost } from '@/lib/card-cost';
import { makeSnapshot, tx } from './helpers';

const on = (over: Parameters<typeof tx>[0] = {}) =>
  tx({ method: 'Coral', category: 'Food', amount: 100, ts: '2026-06-10T10:00:00', ...over });

const snap = (rows: ReturnType<typeof tx>[]) => makeSnapshot({ transactions: rows });

const FROM = '2026-01-01';
const TO = '2026-12-31';

describe('cardCost', () => {
  it('totals surcharges and the tax on them, separately', () => {
    const c = cardCost(
      snap([
        on({ amount: 20, category: 'Surcharge', remarks: 'Fuel surcharge' }),
        on({ amount: 3.6, category: 'Taxes', remarks: 'Tax' }),
        on({ amount: 1000, category: 'Food', remarks: 'Dinner' }),
      ]),
      FROM, TO,
    );
    expect(c).toMatchObject({ surcharge: 20, tax: 3.6, total: 23.6, count: 2 });
  });

  /* The split that makes it actionable: an EMI's charges were agreed when the
     plan started, a fuel surcharge is a choice about which card goes into
     which pump. One total invites the wrong conclusion about both. */
  it('separates fees committed to an instalment from the rest', () => {
    const c = cardCost(
      snap([
        on({ amount: 228.24, category: 'Surcharge', remarks: 'Ipad Mini 18/24 Charge' }),
        on({ amount: 41.08, category: 'Taxes', remarks: 'Ipad Mini 18/24 Tax' }),
        on({ amount: 20, category: 'Surcharge', remarks: 'Fuel surcharge' }),
      ]),
      FROM, TO,
    );
    expect(c.committed).toBe(269.32);
    expect(c.avoidable).toBe(20);
    expect(c.total).toBe(289.32);
  });

  /* Measured against spend, not against everything: bill payments and lending
     are not spending, and counting them would shrink the share into looking
     harmless. */
  it('measures its share against spending alone', () => {
    const c = cardCost(
      snap([
        on({ amount: 100, category: 'Surcharge', remarks: 'Fee' }),
        on({ amount: 900, category: 'Food' }),
        tx({ method: 'Fi', category: 'Coral', remarks: 'Cleared', amount: 50000, ts: '2026-06-11T10:00:00' }),
        on({ amount: 5000, category: 'Credit Given', remarks: 'Ashiq' }),
      ]),
      FROM, TO,
    );
    // Spend is the 900 plus the 100 fee, which is itself a spend category.
    expect(c.shareOfSpend).toBeCloseTo(100 / 1000);
  });

  it('breaks the total down by card, biggest first', () => {
    const c = cardCost(
      snap([
        on({ amount: 20, category: 'Surcharge', method: 'Coral', remarks: 'Fee' }),
        on({ amount: 300, category: 'Surcharge', method: 'Scapia', remarks: 'Fee' }),
      ]),
      FROM, TO,
    );
    expect(c.byCard.map((r) => r.key)).toEqual(['Scapia', 'Coral']);
    expect(c.byCard[0]!.share).toBeCloseTo(300 / 320);
  });

  it('gives a month series with no phantom empty months', () => {
    const c = cardCost(
      snap([
        on({ amount: 20, category: 'Surcharge', ts: '2026-02-05T10:00:00', remarks: 'Fee' }),
        on({ amount: 30, category: 'Surcharge', ts: '2026-06-05T10:00:00', remarks: 'Fee' }),
      ]),
      FROM, TO,
    );
    expect(c.byMonth).toEqual([
      { month: '2026-02', total: 20 },
      { month: '2026-06', total: 30 },
    ]);
  });

  it('honours the window', () => {
    const rows = [
      on({ amount: 20, category: 'Surcharge', ts: '2026-02-05T10:00:00', remarks: 'Fee' }),
      on({ amount: 30, category: 'Surcharge', ts: '2026-06-05T10:00:00', remarks: 'Fee' }),
    ];
    expect(cardCost(snap(rows), '2026-06-01', '2026-06-30').total).toBe(30);
  });

  it('lists the biggest individual charges', () => {
    const c = cardCost(
      snap([
        on({ amount: 5, category: 'Surcharge', remarks: 'Small fee' }),
        on({ amount: 500, category: 'Surcharge', remarks: 'Big fee' }),
      ]),
      FROM, TO,
    );
    expect(c.largest.map((t) => t.remarks)).toEqual(['Big fee', 'Small fee']);
  });

  it('reports zero rather than dividing by it', () => {
    const c = cardCost(makeSnapshot({}), FROM, TO);
    expect(c).toMatchObject({ total: 0, count: 0, shareOfSpend: 0, committed: 0, avoidable: 0 });
    expect(c.byCard).toEqual([]);
  });
});
