import { describe, expect, it } from 'vitest';
import { areaOf, placeAnalytics } from '@/lib/place-analytics';
import type { Transaction } from '@/lib/types';

const tx = (id: string, ts: string, amount: number, category = 'Food', kind = 'spend'): Transaction => ({
  id, ts, amount, method: 'Fi', category, remarks: id, userTags: [], kind, cardAffected: null, cardDirection: null,
  tags: {}, verified: false, needsReview: false, deleted: false, source: 'app',
} as Transaction);

const P = {
  hwy: { lat: 11.07, lon: 76.07, label: 'Calicut-Malappuram-Palakkad Highway, Downhill' },
  ration: { lat: 11.07, lon: 76.07, label: 'Ration Shop, Downhill · Calicut-Malappuram-Palakkad Highway, Ernad' },
  ems: { lat: 10.98, lon: 76.2, label: 'EMS Memorial Co-Operative Hospital & Research Centre, Pathaikkara' },
};

describe('where the money goes, by area', () => {
  it('an area is the locality at the end of the place’s name', () => {
    expect(areaOf(P.hwy)).toBe('Downhill');
    expect(areaOf(P.ration)).toBe('Downhill');
    expect(areaOf({ lat: 11, lon: 76, label: 'Pallimukh' })).toBe('Pallimukh');
    expect(areaOf({ lat: 11.071, lon: 76.069 })).toBe('Near 11.07, 76.07');
  });

  it('groups located spending by area, says how much it can see, and lists the biggest', () => {
    const txs = [
      tx('a', '2026-11-03T10:00:00', 2000),
      tx('b', '2026-11-04T10:00:00', 400, 'Groceries'),
      tx('c', '2026-11-05T10:00:00', 600, 'Medicine'),
      tx('d', '2026-11-06T10:00:00', 1000),            // no place
      tx('e', '2026-11-06T11:00:00', 5000, 'Coral', 'card_payment'), // a bill payment: not spend
    ];
    const v = placeAnalytics(txs, { a: P.hwy, b: P.ration, c: P.ems, e: P.hwy }, null, 2);
    expect(v.coverage).toEqual({ spent: 4000, placedSpent: 3000, count: 4, placedCount: 3, since: '2026-11-03T10:00:00' });
    expect(v.areas.map((a) => [a.area, a.spent, a.count, a.places])).toEqual([['Downhill', 2400, 2, 2], ['Pathaikkara', 600, 1, 1]]);
    expect(v.areas[0]!.categories).toEqual([{ category: 'Food', spent: 2000 }, { category: 'Groceries', spent: 400 }]);
    expect(v.areas[0]!.share).toBeCloseTo(0.8);
    expect(v.biggest.map((b) => [b.id, b.where])).toEqual([['a', 'Calicut-Malappuram-Palakkad Highway'], ['c', 'EMS Memorial Co-Operative Hospital & Research Centre']]);
  });

  it('a month narrows everything to that month', () => {
    const v = placeAnalytics([tx('a', '2026-10-03T10:00:00', 50), tx('b', '2026-11-03T10:00:00', 70)], { a: P.hwy, b: P.hwy }, '2026-11');
    expect(v.coverage.placedSpent).toBe(70);
  });
});
