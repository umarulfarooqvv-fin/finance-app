import { describe, expect, it } from 'vitest';
import { byDay, exploreCategories, type ExploreRow } from '@/lib/category-explore';

const row = (id: string, ts: string, amount: number, category: string, remarks = '', kind: ExploreRow['kind'] = 'spend'): ExploreRow =>
  ({ id, ts, amount, category, remarks, tags: [], kind });

const rows: ExploreRow[] = [
  row('a', '2026-09-01T10:00:00', 100.1, 'Food', 'Tea'),
  row('b', '2026-09-02T10:00:00', 200.2, 'Food', 'Dinner (Banglore Trip)'),
  row('c', '2026-09-02T12:00:00', 50, 'Fuel', 'Petrol'),
  row('d', '2026-09-03T09:00:00', 900, 'Credit Given', 'Lent to Arshad', 'credit_given'),
  row('e', '2026-09-03T09:30:00', 400, 'Family', 'Banglore Trip gift'),
];

describe('exploreCategories', () => {
  it('counts spend only by default, with totals in paise', () => {
    const r = exploreCategories(rows, { scope: 'spend', sort: 'total' });
    expect(r.groups.map((g) => g.category)).toEqual(['Family', 'Food', 'Fuel']);
    expect(r.total).toBe(750.3);
    const food = r.groups.find((g) => g.category === 'Food')!;
    expect(food.total).toBe(300.3);
    expect(food.average).toBe(150.15);
    expect(food.largest).toBe(200.2);
    expect(food.rows[0]!.id).toBe('b'); // newest first
  });

  it('sorts by count, average and name', () => {
    expect(exploreCategories(rows, { scope: 'spend', sort: 'count' }).groups[0]!.category).toBe('Food');
    expect(exploreCategories(rows, { scope: 'spend', sort: 'average' }).groups[0]!.category).toBe('Family');
    expect(exploreCategories(rows, { scope: 'spend', sort: 'name' }).groups.map((g) => g.category))
      .toEqual(['Family', 'Food', 'Fuel']);
  });

  it('switches scope to all charges or lending only', () => {
    expect(exploreCategories(rows, { scope: 'all', sort: 'total' }).groups[0]!.category).toBe('Credit Given');
    expect(exploreCategories(rows, { scope: 'lent', sort: 'total' }).total).toBe(900);
  });

  it('filters on every word typed, across remarks and category', () => {
    const r = exploreCategories(rows, { scope: 'spend', sort: 'total', query: 'banglore' });
    expect(r.count).toBe(2);
    expect(exploreCategories(rows, { scope: 'spend', sort: 'total', query: 'food tea' }).count).toBe(1);
  });
});

describe('byDay', () => {
  it('groups newest day first with the day total', () => {
    const days = byDay(rows);
    expect(days[0]!.day).toBe('2026-09-03');
    expect(days.find((d) => d.day === '2026-09-02')!.total).toBe(250.2);
  });
});
