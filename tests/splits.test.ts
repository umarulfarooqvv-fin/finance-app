import { describe, expect, it } from 'vitest';
import { makeSnapshot } from './helpers';
import { entriesInSplits, ME, settleUp, splitsFrom, splitView, type Split } from '@/lib/splits';
import type { Transaction } from '@/lib/types';

const tx = (id: string, day: string, amount: number, remarks: string, userTags: string[] = []): Transaction => ({
  id, ts: `${day}T12:00:00`, amount, method: 'Fi', category: 'Food', remarks, userTags, kind: 'spend', cardAffected: null,
  cardDirection: null, tags: {}, verified: false, needsReview: false, deleted: false, source: 'app',
} as Transaction);

const trip = (over: Partial<Split> = {}): Split => ({
  id: 's1', name: 'Wayanad', day: '2026-05-30',
  people: [{ id: 'a', name: 'Ashiq' }, { id: 'f', name: 'Faisal' }],
  match: ['Wayanad Trip'], expenses: [], settlements: [], ...over,
});

describe('splitting with friends', () => {
  it('your tagged entries and a friend’s typed payment, split three ways', () => {
    const snap = makeSnapshot({ transactions: [
      tx('t1', '2026-05-30', 1500, 'Fuel', ['Wayanad Trip']),
      tx('t2', '2026-05-31', 900, 'Dinner', ['Wayanad Trip']),
      tx('t3', '2026-05-31', 50, 'Tea'),
    ] });
    const v = splitView(snap, trip({ expenses: [{ id: 'e1', payer: 'a', amount: 600, day: '2026-05-31', note: 'Room' }] }));
    expect(v.total).toBe(3000);
    expect(v.balances.map((b) => [b.person, b.balance])).toEqual([[ME, 1400], ['a', -400], ['f', -1000]]);
    expect(v.transfers).toEqual([{ from: 'f', to: ME, amount: 1000 }, { from: 'a', to: ME, amount: 400 }]);
    expect(v.mine).toBe(1400);
  });

  it('an expense only some shared is split among them only', () => {
    const v = splitView(makeSnapshot({}), trip({ match: [], expenses: [
      { id: 'e1', payer: ME, amount: 300, day: '2026-05-30', among: [ME, 'a'] },
    ] }));
    expect(v.balances.map((b) => b.share)).toEqual([150, 150, 0]);
    expect(v.transfers).toEqual([{ from: 'a', to: ME, amount: 150 }]);
  });

  it('a payment made to settle up takes that much off what is left', () => {
    const v = splitView(makeSnapshot({}), trip({ match: [],
      expenses: [{ id: 'e1', payer: ME, amount: 900, day: '2026-05-30' }],
      settlements: [{ id: 'x', from: 'a', to: ME, amount: 300, day: '2026-06-02' }],
    }));
    expect(v.transfers).toEqual([{ from: 'f', to: ME, amount: 300 }]);
    expect(v.mine).toBe(300);
  });

  it('the fewest payments, and nothing under half a rupee', () => {
    expect(settleUp([
      { person: 'x', balance: 100 }, { person: 'y', balance: -40 }, { person: 'z', balance: -60 },
    ])).toEqual([{ from: 'z', to: 'x', amount: 60 }, { from: 'y', to: 'x', amount: 40 }]);
    expect(settleUp([{ person: 'x', balance: 0.3 }, { person: 'y', balance: -0.3 }])).toEqual([]);
  });

  it('a wrongly matched entry can be left out', () => {
    const snap = makeSnapshot({ transactions: [tx('t1', '2026-05-30', 1500, 'Fuel', ['Wayanad Trip'])] });
    expect(splitView(snap, trip({ exclude: ['t1'] })).total).toBe(0);
  });

  it('reads stored splits, dropping what makes no sense', () => {
    const s = splitsFrom({ splits: [
      { id: 's', name: 'Dinner', day: '2026-06-01', people: [{ id: 'a', name: 'Ashiq' }, { id: 'me', name: 'x' }],
        expenses: [{ id: 'e', payer: 'zz', amount: 10, day: '2026-06-01' }, { id: 'e2', payer: 'a', amount: 10, day: '2026-06-01', among: ['a', 'nobody'] }],
        settlements: [] },
      { id: '', name: 'bad', day: '2026-06-01' },
    ] });
    expect(s).toHaveLength(1);
    expect(s[0]!.people).toEqual([{ id: 'a', name: 'Ashiq' }]);
    expect(s[0]!.expenses).toEqual([{ id: 'e2', payer: 'a', amount: 10, day: '2026-06-01', among: ['a'] }]);
  });

  it('your Credit Given entries picked in count as what you paid, once', () => {
    const lent = { ...tx('cg', '2026-06-01', 900, 'Dinner with friends'), category: 'Credit Given' } as Transaction;
    const snap = makeSnapshot({ transactions: [lent, tx('t1', '2026-06-01', 300, 'Fuel', ['Wayanad Trip'])] });
    const v = splitView(snap, trip({ include: ['cg', 't1'] }));
    expect(v.rows.map((r) => r.id).sort()).toEqual(['cg', 't1']);
    expect(v.total).toBe(1200);
    expect(entriesInSplits(snap, [trip({ include: ['cg'] })])).toEqual(new Set(['cg', 't1']));
  });

  it('received back and written off both close a debt; written off is your loss', () => {
    const v = splitView(makeSnapshot({}), trip({ match: [],
      expenses: [{ id: 'e1', payer: ME, amount: 900, day: '2026-05-30' }],
      settlements: [
        { id: 'x', from: 'a', to: ME, amount: 300, day: '2026-06-02' },
        { id: 'y', from: 'f', to: ME, amount: 100, day: '2026-06-09', kind: 'writeoff' },
      ],
    }));
    expect(v.recovered).toBe(300);
    expect(v.lost).toBe(100);
    expect(v.transfers).toEqual([{ from: 'f', to: ME, amount: 200 }]);
    expect(v.mine).toBe(200);
  });
});
