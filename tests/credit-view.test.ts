import { describe, expect, it } from 'vitest';
import { describe as describeText, viewCredit, type CreditPerson } from '@/lib/credit-view';

const e = (id: string, ts: string, amount: number, repaid: number, remarks: string) =>
  ({ id, ts, amount, repaid, outstanding: amount - repaid, remarks, method: 'Scapia' });

const PEOPLE: CreditPerson[] = [
  {
    person: 'Ashiq',
    entries: [
      e('a1', '2026-01-02T10:00:00', 500, 500, 'Ashiq food'),
      e('a2', '2026-02-02T10:00:00', 1000, 200, 'Ashiq petrol'),
      e('a3', '2026-03-02T10:00:00', 300, 0, 'Ashiq food'),
    ],
    repayments: [{ id: 'r1', ts: '2026-02-10T09:00:00', amount: 700, note: 'Ashiq back' }],
  },
  {
    person: 'Faris',
    entries: [e('f1', '2026-03-05T10:00:00', 250, 0, 'Food for Faris [Banglore Trip]')],
    repayments: [],
  },
];

describe('credit given, searchable', () => {
  it('totals what is still owed, and lent − back = owed', () => {
    const { groups, totals } = viewCredit(PEOPLE, {});
    expect(groups.map((g) => g.label)).toEqual(['Ashiq', 'Faris']);
    expect(totals).toEqual({ count: 3, lent: 1550, back: 200, outstanding: 1350 });
  });

  it('a name keeps all of that person; "all" includes repaid lendings', () => {
    const { totals } = viewCredit(PEOPLE, { q: 'ashiq', status: 'all' });
    expect(totals).toEqual({ count: 3, lent: 1800, back: 700, outstanding: 1100 });
  });

  it('a description totals only the lendings it matches, across people', () => {
    const { groups, totals } = viewCredit(PEOPLE, { q: 'food', status: 'all' });
    expect(groups.map((g) => g.label)).toEqual(['Ashiq', 'Faris']);
    expect(totals).toEqual({ count: 3, lent: 1050, back: 500, outstanding: 550 });
  });

  it('groups by description, tag dropped, case folded', () => {
    const { groups } = viewCredit(PEOPLE, { status: 'all', groupBy: 'description' });
    const food = groups.find((g) => g.label === 'Ashiq food')!;
    expect(food.totals).toEqual({ count: 2, lent: 800, back: 500, outstanding: 300 });
    expect(describeText('Food for Faris [Banglore Trip]')).toBe('Food for Faris');
  });
});
