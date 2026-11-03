import { describe, expect, it } from 'vitest';
import { planReturn, statementReport } from '@/lib/statement-report';
import { income, makeSnapshot, tx } from './helpers';
import { DEFAULT_CARDS } from '@/lib/defaults';

/* Coral bills on the 25th: the statement of 25 Jul covers 26 Jun – 25 Jul. */
const coral = { ...DEFAULT_CARDS.find((c) => c.name === 'Coral')!, openingBalance: 0 };
const on = (over: Parameters<typeof tx>[0] = {}) =>
  tx({ method: 'Coral', category: 'Food', amount: 100, ts: '2026-07-02T10:00:00', ...over });

const snap = makeSnapshot({
  cards: [coral],
  loadedAt: '2026-08-10T12:00:00',
  transactions: [
    on({ amount: 500 }),
    on({ amount: 300, category: 'Fuel' }),
    on({ amount: 9000, category: 'Credit Given', remarks: 'Ashiq', ts: '2026-07-05T10:00:00' }),
    on({ amount: 2000, category: 'Credit Given', remarks: 'Faris', ts: '2026-07-06T10:00:00' }),
    on({ amount: 200, ts: '2026-06-10T10:00:00' }), // the statement before
  ],
  income: [
    income({ amount: 4000, source: 'Credit Return', remarks: 'Ashiq returned', account: 'Fi', ts: '2026-07-20T10:00:00' }),
    income({ amount: 700, source: 'Credit Return', remarks: 'cash back from a friend', account: 'Cash', ts: '2026-07-22T10:00:00' }),
  ],
});

const report = statementReport(snap, 'Coral')!;

describe('statementReport', () => {
  it('reports the latest statement by default, and names its cycle', () => {
    expect(report.cycle.statementEnd).toBe('2026-07-25');
    expect(report.cycle.cycleStart).toBe('2026-06-26');
    expect(report.statements[0]!.statementEnd).toBe('2026-07-25');
  });

  it('splits the charges into own, lent and other — and they add up', () => {
    expect(report.parts).toEqual({ own: 800, lent: 11000, other: 0 });
    expect(report.parts.own + report.parts.lent + report.parts.other).toBe(report.bill.charges);
  });

  it('says whether each lending has come back, by the ledger’s own allocation', () => {
    const ashiq = report.people.find((p) => p.person === 'Ashiq')!;
    expect(ashiq).toMatchObject({ lent: 9000, repaid: 4000, outstanding: 5000 });
    expect(ashiq.lendings[0]).toMatchObject({ status: 'partly', repaid: 4000, outstanding: 5000 });
    const faris = report.people.find((p) => p.person === 'Faris')!;
    expect(faris.lendings[0]).toMatchObject({ status: 'waiting', outstanding: 2000, daysWaiting: 35 });
    expect(report.lentSplit).toEqual({ returned: 4000, waiting: 7000 });
  });

  it('lists the returns received, with the account each landed in', () => {
    const ashiq = report.people.find((p) => p.person === 'Ashiq')!;
    expect(ashiq.returns[0]).toMatchObject({ amount: 4000, account: 'Fi' });
  });

  it('keeps the order a repayment will settle things in', () => {
    const ashiq = report.people.find((p) => p.person === 'Ashiq')!;
    expect(ashiq.queue.map((q) => q.outstanding)).toEqual([5000]);
  });

  it('surfaces money that came back but is linked to nobody', () => {
    expect(report.unlinked.map((u) => u.amount)).toEqual([700]);
  });

  it('draws every day of the cycle, and finds the busiest', () => {
    expect(report.days.count).toBe(30);
    expect(report.days.series.reduce((a, d) => a + d.total, 0)).toBe(800);
    expect(report.days.busiest).toEqual({ day: '2026-07-02', total: 800 });
    expect(report.days.spendingDays).toBe(1);
    expect(report.weekdays).toHaveLength(7);
    expect(report.weekdays.reduce((a, w) => a + w.total, 0)).toBe(800);
  });

  it('compares with the statement before', () => {
    expect(report.versus).toMatchObject({ previous: '2026-06-25', own: 200, lent: 0 });
    expect(report.versus!.categories.find((c) => c.key === 'Food')).toEqual({ key: 'Food', now: 500, before: 200 });
  });

  it('answers for an unknown card, and picks a past statement when asked', () => {
    expect(statementReport(snap, 'Nope')).toBeNull();
    expect(statementReport(snap, 'Coral', '2026-06-25')!.parts.own).toBe(200);
  });
});

describe('planReturn — what a payment will settle', () => {
  const queue = [
    { txId: 'a', ts: '2026-01-19T10:00:00', remarks: 'oldest', outstanding: 3317.5 },
    { txId: 'b', ts: '2026-02-03T10:00:00', remarks: 'next', outstanding: 5137.5 },
    { txId: 'c', ts: '2026-02-28T10:00:00', remarks: 'newest', outstanding: 3000 },
  ] as const;
  const q = [...queue] as Parameters<typeof planReturn>[0];

  it('settles the oldest first, in full, then part of the next', () => {
    const p = planReturn(q, 10350);
    expect(p.lines.map((l) => [l.txId, l.apply, l.full])).toEqual([['a', 3317.5, true], ['b', 5137.5, true], ['c', 1895, false]]);
    expect(p.extra).toBe(0);
  });

  it('paying back the newest does not skip the older ones', () => {
    const p = planReturn(q, 3000);
    expect(p.lines.map((l) => l.txId)).toEqual(['a']);
    expect(p.lines[0]).toMatchObject({ apply: 3000, full: false });
  });

  it('reports what is more than they owed, without a rounding drift', () => {
    expect(planReturn(q, 12000).extra).toBe(545);
    expect(planReturn(q, 0.1 + 0.2).lines[0]!.apply).toBe(0.3);
  });
});
