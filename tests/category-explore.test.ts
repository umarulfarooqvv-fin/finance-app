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

describe('one sort orders the categories AND the entries inside them', () => {
  const r = (id: string, ts: string, amount: number, remarks = id): ExploreRow => ({
    id, ts, amount, category: 'Family', remarks, tags: [], kind: 'spend',
  });
  const inside = [
    r('tea', '2026-10-01T09:00:00', 50),
    r('shop', '2026-10-01T18:00:00', 3000),
    r('bus', '2026-10-05T08:00:00', 120),
    r('milk', '2026-10-05T09:00:00', 60),
    r('rent', '2026-10-09T10:00:00', 400),
  ];
  const days = (sort: Parameters<typeof byDay>[1]) => byDay(inside, sort).map((d) => d.day.slice(8));
  const ids = (sort: Parameters<typeof byDay>[1]) => byDay(inside, sort).flatMap((d) => d.rows.map((x) => x.id));

  it('highest total: the biggest day first, the biggest amount first within it', () => {
    expect(days('total')).toEqual(['01', '09', '05']);
    expect(ids('total')).toEqual(['shop', 'tea', 'rent', 'bus', 'milk']);
  });

  it('newest and oldest run by date, rows by time the same way', () => {
    expect(days('newest')).toEqual(['09', '05', '01']);
    expect(ids('newest')).toEqual(['rent', 'milk', 'bus', 'shop', 'tea']);
    expect(days('oldest')).toEqual(['01', '05', '09']);
    expect(ids('oldest')).toEqual(['tea', 'shop', 'bus', 'milk', 'rent']);
  });

  it('most entries: the day with the most entries first', () => {
    expect(days('count').slice(0, 2)).toEqual(['05', '01']);
  });

  it('A–Z keeps the days newest first and sorts within each', () => {
    expect(days('name')).toEqual(['09', '05', '01']);
    expect(ids('name')).toEqual(['rent', 'bus', 'milk', 'shop', 'tea']);
  });

  it('entries stay grouped by day and still add up, whatever the sort', () => {
    for (const s of ['total', 'count', 'average', 'name', 'newest', 'oldest'] as const) {
      const g = byDay(inside, s);
      expect(g.reduce((a, d) => a + d.total, 0)).toBe(3630);
      expect(g.every((d) => d.rows.every((x) => x.ts.startsWith(d.day)))).toBe(true);
    }
  });

  it('categories can be ordered by when they were last or first used', () => {
    const rows = [
      { ...r('a', '2026-10-09T10:00:00', 10), category: 'Food' },
      { ...r('b', '2026-10-01T10:00:00', 10), category: 'Food' },
      { ...r('c', '2026-10-05T10:00:00', 999), category: 'Fuel' },
    ];
    expect(exploreCategories(rows, { scope: 'spend', sort: 'newest' }).groups.map((g) => g.category)).toEqual(['Food', 'Fuel']);
    expect(exploreCategories(rows, { scope: 'spend', sort: 'oldest' }).groups.map((g) => g.category)).toEqual(['Food', 'Fuel']);
    expect(exploreCategories(rows, { scope: 'spend', sort: 'total' }).groups.map((g) => g.category)).toEqual(['Fuel', 'Food']);
  });
});
