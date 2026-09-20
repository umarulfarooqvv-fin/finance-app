import { describe, expect, it } from 'vitest';
import { duesToNotify, upcomingDues, type Due } from '@/lib/upcoming';
import { composeDigest } from '@/lib/push';
import { makeSnapshot, tx } from './helpers';
import { DEFAULT_CARDS } from '@/lib/defaults';

const coral = DEFAULT_CARDS.find((c) => c.name === 'Coral')!;
const oneCard = { ...coral, name: 'Coral' };

/** A snapshot with one spend on Coral big enough to leave a bill outstanding. */
const withBill = (day: string, amount = 5000) =>
  makeSnapshot({
    cards: [oneCard],
    loadedAt: `${day}T12:00:00`,
    transactions: [tx({ method: 'Coral', category: 'Personal', amount, ts: `${day}T09:00:00` })],
  });

describe('upcomingDues', () => {
  it('reports a card bill with what is still owed on it', () => {
    const snap = withBill('2026-06-02');
    const dues = upcomingDues(snap, '2026-06-02', 60);
    const bill = dues.find((d) => d.kind === 'bill');
    expect(bill).toBeTruthy();
    expect(bill!.card).toBe('Coral');
    expect(bill!.amount).toBeGreaterThan(0);
  });

  /* The rule the whole feature rests on. A notification for a bill of zero is
     how someone learns to swipe this app away without reading it. */
  it('says nothing about a card with nothing owing', () => {
    // Opening balance zeroed: the default fixture carries one, and a card
    // with an opening balance genuinely DOES owe something with no rows.
    const clear = { ...oneCard, openingBalance: 0 };
    const snap = makeSnapshot({ cards: [clear], loadedAt: '2026-06-02T12:00:00' });
    expect(upcomingDues(snap, '2026-06-02', 60).filter((d) => d.kind === 'bill')).toHaveLength(0);
  });

  it('keeps everything beyond the horizon out', () => {
    const snap = withBill('2026-06-02');
    expect(upcomingDues(snap, '2026-06-02', 0).every((d) => d.daysAway === 0)).toBe(true);
  });

  it('never reports a date already gone', () => {
    const snap = withBill('2026-06-02');
    expect(upcomingDues(snap, '2026-06-02', 60).every((d) => d.daysAway >= 0)).toBe(true);
  });

  it('reads a confirmed subscription from config', () => {
    const snap = makeSnapshot({
      cards: [oneCard],
      loadedAt: '2026-06-10T12:00:00',
      config: {
        subscriptions: {
          minoxidil: {
            name: 'Minoxidil', amount: 649.19, everyDays: 30,
            method: 'Fi', category: 'Personal', lastOn: '2026-06-07',
          },
        },
      },
    });
    const sub = upcomingDues(snap, '2026-06-10', 60).find((d) => d.kind === 'subscription');
    expect(sub).toMatchObject({ title: 'Minoxidil', amount: 649.19, on: '2026-07-07' });
  });

  /* Detection proposes; a person decides. Nothing unconfirmed may reach a
     notification. */
  it('ignores a subscription that only LOOKS recurring', () => {
    const days = ['2026-04-07', '2026-05-07', '2026-06-07'];
    const snap = makeSnapshot({
      cards: [oneCard],
      loadedAt: '2026-06-10T12:00:00',
      transactions: days.map((d) =>
        tx({ remarks: 'Minoxidil', amount: 649.19, method: 'Fi', ts: `${d}T10:00:00` }),
      ),
    });
    expect(upcomingDues(snap, '2026-06-10', 60).some((d) => d.kind === 'subscription')).toBe(false);
  });

  it('sorts soonest first', () => {
    const snap = withBill('2026-06-02');
    const dues = upcomingDues(snap, '2026-06-02', 120);
    const days = dues.map((d) => d.on);
    expect([...days].sort()).toEqual(days);
  });
});

describe('duesToNotify', () => {
  const subAt = (lastOn: string) => ({
    subscriptions: {
      m: { name: 'Minoxidil', amount: 649.19, everyDays: 30, method: 'Fi', category: 'Personal', lastOn },
    },
  });

  /* Fires ON the lead day and stays quiet the rest. Repeating daily is how a
     reminder becomes nagging, and nagging becomes a muted app. */
  it('fires only on a lead boundary', () => {
    const snap = (today: string) =>
      makeSnapshot({ cards: [oneCard], loadedAt: `${today}T12:00:00`, config: subAt('2026-06-07') });
    // Next occurrence is 7 Jul.
    expect(duesToNotify(snap('2026-07-04'), '2026-07-04', [3]).map((d) => d.title)).toEqual(['Minoxidil']);
    expect(duesToNotify(snap('2026-07-05'), '2026-07-05', [3])).toHaveLength(0);
    expect(duesToNotify(snap('2026-07-06'), '2026-07-06', [3])).toHaveLength(0);
  });

  it('honours several lead days', () => {
    const snap = makeSnapshot({
      cards: [oneCard], loadedAt: '2026-07-07T12:00:00', config: subAt('2026-06-07'),
    });
    expect(duesToNotify(snap, '2026-07-07', [3, 0])).toHaveLength(1);
  });

  it('is silent when no lead day is configured', () => {
    const snap = makeSnapshot({ cards: [oneCard], config: subAt('2026-06-07') });
    expect(duesToNotify(snap, '2026-07-04', [])).toHaveLength(0);
  });
});

/* --- The digest --------------------------------------------------------- */
describe('composeDigest', () => {
  const d = (over: Partial<Due>): Due => ({
    kind: 'bill', id: 'x', title: 'Coral bill', amount: 100, on: '2026-07-07',
    daysAway: 3, card: 'Coral', ...over,
  });

  it('says nothing when nothing is due', () => {
    expect(composeDigest([])).toBeNull();
  });

  it('names the one thing when there is one', () => {
    const p = composeDigest([d({ title: 'Coral bill', daysAway: 0 })])!;
    expect(p.title).toBe('Coral bill due today');
  });

  /* Three notifications for three things on one day is three swipes and no
     more information than one line saying so. */
  it('rolls several dues into one message, largest first', () => {
    const p = composeDigest([
      d({ title: 'Small', amount: 50 }),
      d({ title: 'Large', amount: 5000 }),
    ])!;
    expect(p.title).toBe('2 payments coming up');
    expect(p.body.indexOf('Large')).toBeLessThan(p.body.indexOf('Small'));
  });

  it('summarises the tail rather than listing everything', () => {
    const many = Array.from({ length: 9 }, (_, i) => d({ title: `Item ${i}`, amount: 100 - i }));
    expect(composeDigest(many)!.body).toContain('and 5 more');
  });

  it('copes with a due whose amount is unknown', () => {
    const p = composeDigest([d({ title: 'Netflix', amount: null })])!;
    expect(p.body).toContain('Netflix');
    expect(p.body).not.toContain('₹');
  });
});

/* The lock screen is the one surface this app's privacy blur cannot reach. */
describe('digest privacy', () => {
  const one: Due = {
    kind: 'bill', id: 'x', title: 'Coral bill', amount: 2312.16,
    on: '2026-07-07', daysAway: 3, card: 'Coral',
  };

  it('names no figure unless amounts were asked for', () => {
    const quiet = composeDigest([one])!;
    expect(quiet.body).toContain('Coral bill');
    expect(quiet.body).not.toContain('2,312.16');
  });

  it('names the figure when they were', () => {
    expect(composeDigest([one], true)!.body).toContain('2,312.16');
  });
});
