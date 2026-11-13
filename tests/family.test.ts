import { describe, expect, it } from 'vitest';
import { makeSnapshot } from './helpers';
import { familyErrors, familyFrom, familyView, FAMILY_START, matchesGroup, monthsBetween, type FamilyConfig } from '@/lib/family';
import type { Transaction } from '@/lib/types';

const tx = (id: string, ts: string, amount: number, remarks: string, userTags: string[] = []): Transaction => ({
  id, ts, amount, method: 'Fi', category: 'Family', remarks, userTags, kind: 'spend', cardAffected: null,
  cardDirection: null, tags: {}, verified: false, needsReview: false, deleted: false, source: 'app',
} as Transaction);

const cfg = (over: Partial<FamilyConfig> = {}): FamilyConfig => ({
  members: [
    { id: 'me', name: 'Me', me: true, from: '2000-01-01' },
    { id: 'b1', name: 'Ikka', from: '2000-01-01' },
  ],
  groups: [
    { id: 'car', name: 'Car', kind: 'pledge', match: ['car contribution'], monthly: 5000, from: '2025-09-01', inTotal: true },
    { id: 'uppa', name: 'Hospital', kind: 'shared', match: ['EMS Hospital (Uppa)'], inTotal: false },
  ],
  payments: [],
  ...over,
});

describe('family costs between brothers', () => {
  it('finds the owner’s entries by whole words or by tag', () => {
    expect(matchesGroup({ remarks: 'Car Contribution 6 (Tyre Change)', userTags: [] }, { match: ['car contribution'] })).toBe(true);
    expect(matchesGroup({ remarks: 'Car fuel', userTags: [] }, { match: ['car contribution'] })).toBe(false);
    expect(matchesGroup({ remarks: 'Pharmacy', userTags: ['EMS Hospital (Uppa)'] }, { match: ['ems hospital (uppa)'] })).toBe(true);
  });

  it('counts months from the start month to this one, both included', () => {
    expect(monthsBetween('2025-09-01', '2026-11-12')).toBe(15);
    expect(monthsBetween('2026-12-01', '2026-11-12')).toBe(0);
  });

  it('a pledge: what each person promised so far against what they put in', () => {
    const snap = makeSnapshot({ transactions: [
      tx('a', '2025-09-02T10:00:00', 2500, 'Car Contribution 1'),
      tx('b', '2025-10-01T10:00:00', 2500, 'Car Contribution 2'),
      tx('c', '2025-10-05T10:00:00', 300, 'Car fuel'),
    ] });
    const v = familyView(snap, cfg({ payments: [{ id: 'p1', group: 'car', member: 'b1', amount: 10000, day: '2025-09-05' }] }), '2025-11-20');
    const car = v.groups.find((g) => g.group.id === 'car')!;
    expect(car.tally).toEqual([
      { member: 'me', paid: 5000, owed: 15000, balance: -10000 },
      { member: 'b1', paid: 10000, owed: 15000, balance: -5000 },
    ]);
    expect(car.months.map((m) => m.key)).toEqual(['2025-11', '2025-10', '2025-09']);
    expect(car.months[2]!.paid).toEqual({ me: 2500, b1: 10000 });
  });

  it('a shared cost is split among whoever was in the split that day', () => {
    const snap = makeSnapshot({ transactions: [tx('h', '2026-01-10T10:00:00', 900, 'Scan', ['EMS Hospital (Uppa)'])] });
    const three = cfg({
      members: [...cfg().members, { id: 'b2', name: 'Kunjon', from: '2026-02-01' }],
      payments: [{ id: 'p', group: 'uppa', member: 'b1', amount: 600, day: '2026-03-01' }],
    });
    const h = familyView(snap, three, '2026-03-10').groups.find((g) => g.group.id === 'uppa')!;
    // 900 before Kunjon joined: 450 each of two. 600 after: 200 each of three.
    expect(h.tally).toEqual([
      { member: 'me', paid: 900, owed: 650, balance: 250 },
      { member: 'b1', paid: 600, owed: 650, balance: -50 },
      { member: 'b2', paid: 0, owed: 200, balance: -200 },
    ]);
  });

  it('a late joiner owes a pledge only from when he joined', () => {
    const three = cfg({ members: [...cfg().members, { id: 'b2', name: 'Kunjon', from: '2025-11-15' }] });
    const car = familyView(makeSnapshot({}), three, '2025-11-20').groups[0]!;
    expect(car.tally.find((t) => t.member === 'b2')!.owed).toBe(5000);
  });

  it('the summary counts only groups marked for it; a wrong match can be left out', () => {
    const snap = makeSnapshot({ transactions: [
      tx('a', '2025-09-02T10:00:00', 2500, 'Car Contribution 1'),
      tx('x', '2025-09-03T10:00:00', 999, 'Car contribution wrongly typed'),
      tx('h', '2025-09-10T10:00:00', 900, 'Scan', ['EMS Hospital (Uppa)']),
    ] });
    const c = cfg();
    c.groups[0]!.exclude = ['x'];
    const v = familyView(snap, c, '2025-09-30');
    expect(v.summary.find((s) => s.member === 'me')).toEqual({ member: 'me', paid: 2500, owed: 5000, balance: -2500 });
  });

  it('reads a stored setup, keeping only what makes sense; nothing stored is the suggestion', () => {
    expect(familyFrom({})).toEqual({ cfg: FAMILY_START, saved: false });
    const { cfg: c } = familyFrom({ family: {
      members: [{ id: 'me', name: 'Me', me: true, from: '2000-01-01' }, { id: '', name: 'x' }],
      groups: [{ id: 'g', name: 'Car', kind: 'pledge', match: ['car'], monthly: 5000, from: '2025-09-01' }],
      payments: [{ id: 'p', group: 'g', member: 'me', amount: -5, day: '2025-09-01' }],
    } });
    expect(c.members).toHaveLength(1);
    expect(c.groups[0]).toMatchObject({ kind: 'pledge', monthly: 5000, inTotal: true });
    expect(c.payments).toEqual([]);
  });

  it('refuses a setup with no owner or a pledge with no amount', () => {
    expect(familyErrors(FAMILY_START)).toBeNull();
    expect(familyErrors({ members: [{ id: 'b', name: 'B', from: '2000-01-01' }], groups: [] })).toMatch(/you/);
    expect(familyErrors({ ...FAMILY_START, groups: [{ id: 'g', name: 'Car', kind: 'pledge', match: [], inTotal: true }] })).toMatch(/month/);
  });
});
