import { describe, expect, it } from 'vitest';
import { analyseCard } from '@/lib/card-analysis';
import { makeSnapshot, tx } from './helpers';
import { DEFAULT_CARDS } from '@/lib/defaults';

const coral = { ...DEFAULT_CARDS.find((c) => c.name === 'Coral')!, openingBalance: 0 };

const on = (over: Parameters<typeof tx>[0] = {}) =>
  tx({ method: 'Coral', category: 'Food', amount: 100, ts: '2026-06-10T10:00:00', ...over });

const snap = (rows: ReturnType<typeof tx>[]) =>
  makeSnapshot({ cards: [coral], transactions: rows, loadedAt: '2026-08-01T12:00:00' });

const FROM = '2026-01-01';
const TO = '2026-12-31';

describe('analyseCard', () => {
  /* The split the whole page rests on: a card can be at its limit entirely on
     money that is owed back, and totalling the two together tells its owner
     they overspent when they did not. */
  it('keeps lending out of spending', () => {
    const a = analyseCard(
      snap([
        on({ amount: 500, category: 'Food' }),
        on({ amount: 9000, category: 'Credit Given', remarks: 'Ashiq' }),
      ]),
      'Coral', FROM, TO,
    );
    expect(a.charges.total).toBe(9500);
    expect(a.spend.total).toBe(500);
    expect(a.byCategory.map((b) => b.key)).toEqual(['Food']);
    expect(a.credit.given).toBe(9000);
  });

  /* Shares are measured against charges, not against everything on the card —
     otherwise "Bill payment 48%" heads a list meant to say where money went. */
  it('excludes the bill payment from the kind breakdown', () => {
    const a = analyseCard(
      snap([
        on({ amount: 500 }),
        tx({ method: 'Fi', category: 'Coral', remarks: 'Cleared', amount: 500, ts: '2026-06-20T10:00:00' }),
      ]),
      'Coral', FROM, TO,
    );
    expect(a.charges.total).toBe(500);
    expect(a.repaid.total).toBe(500);
    expect(a.byKind.map((k) => k.kind)).toEqual(['spend']);
    expect(a.byKind[0]!.share).toBeCloseTo(1);
  });

  it('sorts the largest charges first', () => {
    const a = analyseCard(
      snap([on({ amount: 50 }), on({ amount: 5000 }), on({ amount: 700 })]),
      'Coral', FROM, TO,
    );
    expect(a.largest.map((t) => t.amount)).toEqual([5000, 700, 50]);
  });

  it('totals what the card itself cost', () => {
    const a = analyseCard(
      snap([
        on({ amount: 1000 }),
        on({ amount: 20, category: 'Surcharge', remarks: 'Fuel surcharge' }),
        on({ amount: 3.6, category: 'Taxes', remarks: 'Tax' }),
      ]),
      'Coral', FROM, TO,
    );
    expect(a.cost).toMatchObject({ surcharge: 20, taxes: 3.6, total: 23.6 });
    expect(a.cost.share).toBeCloseTo(23.6 / 1023.6);
  });

  /* "Cleared or not" is the question asked of lending, and the answer has to
     come from the ledger's own FIFO allocation — not a second opinion. */
  it('says whether lending on this card has come back', () => {
    const a = analyseCard(
      snap([
        on({ amount: 1000, category: 'Credit Given', remarks: 'Ashiq', ts: '2026-06-01T10:00:00' }),
        tx({ method: 'Fi', category: 'Credit Return', amount: 1000, remarks: 'Ashiq', ts: '2026-06-20T10:00:00' }),
        on({ amount: 2000, category: 'Credit Given', remarks: 'Fayiz', ts: '2026-06-02T10:00:00' }),
      ]),
      'Coral', FROM, TO,
    );
    const ashiq = a.credit.people.find((p) => p.person.toLowerCase().includes('ashiq'));
    const fayiz = a.credit.people.find((p) => p.person.toLowerCase().includes('fayiz'));
    expect(ashiq?.settled).toBe(true);
    expect(ashiq?.outstanding).toBe(0);
    expect(fayiz?.settled).toBe(false);
    expect(fayiz?.outstanding).toBe(2000);
    expect(a.credit.outstanding).toBe(2000);
  });

  it('puts what is still owed at the top', () => {
    const a = analyseCard(
      snap([
        on({ amount: 500, category: 'Credit Given', remarks: 'Ashiq' }),
        on({ amount: 3000, category: 'Credit Given', remarks: 'Fayiz' }),
      ]),
      'Coral', FROM, TO,
    );
    expect(a.credit.people[0]!.person.toLowerCase()).toContain('fayiz');
  });

  it('gives a month-by-month series with no phantom gaps', () => {
    const a = analyseCard(
      snap([
        on({ amount: 100, ts: '2026-02-05T10:00:00' }),
        on({ amount: 300, ts: '2026-06-05T10:00:00' }),
      ]),
      'Coral', FROM, TO,
    );
    expect(a.monthly).toHaveLength(2);
    expect(a.monthly.map((m) => m.spend)).toEqual([100, 300]);
    expect(a.monthly[0]!.month < a.monthly[1]!.month).toBe(true);
  });

  it('finds charges that repeat under one description', () => {
    const a = analyseCard(
      snap([
        on({ amount: 649.19, remarks: 'Minoxidil', ts: '2026-05-11T10:00:00' }),
        on({ amount: 649.19, remarks: 'minoxidil', ts: '2026-06-13T10:00:00' }),
        on({ amount: 80, remarks: 'Tea', ts: '2026-06-14T10:00:00' }),
      ]),
      'Coral', FROM, TO,
    );
    const hit = a.repeats.find((r) => r.name.toLowerCase() === 'minoxidil');
    expect(hit).toMatchObject({ count: 2, total: 1298.38, each: 649.19 });
    expect(a.repeats.some((r) => r.name === 'Tea')).toBe(false);
  });

  /* An instalment series is one commitment under many names, and the EMI
     tracker already groups it. Listing 18/24 and 19/24 as repeats would be a
     second, worse answer. */
  it('leaves instalments to the EMI tracker', () => {
    const a = analyseCard(
      snap([
        on({ amount: 2350, remarks: 'Ipad Mini 18/24', category: 'Personal' }),
        on({ amount: 2350, remarks: 'Ipad Mini 19/24', category: 'Personal' }),
      ]),
      'Coral', FROM, TO,
    );
    expect(a.repeats).toHaveLength(0);
  });

  it('honours the window it is given', () => {
    const rows = [
      on({ amount: 100, ts: '2026-02-05T10:00:00' }),
      on({ amount: 300, ts: '2026-06-05T10:00:00' }),
    ];
    const a = analyseCard(snap(rows), 'Coral', '2026-06-01', '2026-06-30');
    expect(a.charges.total).toBe(300);
  });

  it('copes with a card that has nothing on it', () => {
    const a = analyseCard(snap([]), 'Coral', FROM, TO);
    expect(a).toMatchObject({ charges: { total: 0, count: 0 }, spend: { total: 0 } });
    expect(a.cost.share).toBe(0);
    expect(a.byKind).toEqual([]);
  });
});
