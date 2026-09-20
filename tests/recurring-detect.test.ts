import { describe, expect, it } from 'vitest';
import { detectRecurring, nextOccurrence, subscriptionsFrom } from '@/lib/recurring-detect';
import { makeSnapshot, tx } from './helpers';

const monthly = (remarks: string, amount: number, days: string[]) =>
  days.map((d) => tx({ remarks, amount, method: 'Fi', category: 'Personal', ts: `${d}T10:00:00` }));

describe('detectRecurring', () => {
  it('finds a charge repeating monthly for the same amount', () => {
    const snap = makeSnapshot({
      transactions: monthly('Minoxidil', 649.19, ['2026-06-07', '2026-07-07', '2026-08-07']),
    });
    const [hit] = detectRecurring(snap, '2026-08-20');
    expect(hit).toMatchObject({ name: 'Minoxidil', seen: 3, amount: 649.19 });
    // 7 Jun to 7 Jul is 30 days, 7 Jul to 7 Aug is 31 — a calendar month is
    // not a fixed number of days, and the median rounds up.
    expect(hit!.everyDays).toBe(31);
    expect(hit!.nextOn).toBe('2026-09-07');
  });

  /* Two of anything look periodic. Three is the fewest that is a rhythm. */
  it('refuses to call two charges a subscription', () => {
    const snap = makeSnapshot({
      transactions: monthly('Minoxidil', 649.19, ['2026-07-07', '2026-08-07']),
    });
    expect(detectRecurring(snap, '2026-08-20')).toHaveLength(0);
  });

  /* A run that stopped is not a subscription, however tidy its median: the
     three-monthly charges here are years old and the recent one stands alone. */
  it('rejects a run that stopped, however tidy its median', () => {
    const snap = makeSnapshot({
      transactions: monthly('Old gym', 1200, ['2025-01-05', '2025-02-05', '2025-03-05', '2026-08-05']),
    });
    expect(detectRecurring(snap, '2026-08-20')).toHaveLength(0);
  });

  /* Found against real data. Judging EVERY gap ever recorded disqualified a
     live subscription for one lapse long ago — Minoxidil had been monthly for
     five months and was rejected for a 62-day gap the previous winter. What
     matters is whether something recurs NOW, so only the current run counts. */
  it('accepts a charge that is monthly now despite an old lapse', () => {
    const snap = makeSnapshot({
      transactions: monthly('Minoxidil', 649.19, [
        '2026-01-05', // then a 62-day gap
        '2026-03-08', '2026-04-07', '2026-05-11', '2026-06-13', '2026-07-14',
      ]),
    });
    const [hit] = detectRecurring(snap, '2026-08-01');
    expect(hit?.name).toBe('Minoxidil');
    expect(hit!.seen).toBe(5);
  });

  /* The other half of the same rule: a price that changed two runs ago must
     not drag the predicted amount away from what it costs today. */
  it('quotes the amount from the current run, not from history', () => {
    const snap = makeSnapshot({
      transactions: [
        ...monthly('Streaming', 199, ['2026-03-02', '2026-04-02']),
        ...monthly('Streaming', 499, ['2026-05-02', '2026-06-02', '2026-07-02']),
      ],
    });
    expect(detectRecurring(snap, '2026-07-20')).toHaveLength(0);
  });

  it('rejects amounts that wander too far to quote in a reminder', () => {
    const snap = makeSnapshot({
      transactions: [
        ...monthly('Groceries', 500, ['2026-06-07']),
        ...monthly('Groceries', 2400, ['2026-07-07']),
        ...monthly('Groceries', 900, ['2026-08-07']),
      ],
    });
    expect(detectRecurring(snap, '2026-08-20')).toHaveLength(0);
  });

  it('treats a curled and a straight apostrophe as one subscription', () => {
    const snap = makeSnapshot({
      transactions: [
        ...monthly('Sheya’s tutor', 800, ['2026-06-02', '2026-07-02']),
        ...monthly("Sheya's tutor", 800, ['2026-08-02']),
      ],
    });
    expect(detectRecurring(snap, '2026-08-20')).toHaveLength(1);
  });

  /* Both are already modelled. Re-deriving them from coincidence would give
     two answers to one question. */
  it('leaves EMIs and bill payments to the engines that own them', () => {
    const snap = makeSnapshot({
      transactions: [
        ...monthly("Sheya's 21/24 Emi", 2914.86, ['2026-06-01']),
        ...monthly("Sheya's 22/24 Emi", 2908.29, ['2026-07-01']),
        ...monthly("Sheya's 23/24 Emi", 2901.63, ['2026-08-01']),
        ...['2026-06-11', '2026-07-11', '2026-08-11'].map((d) =>
          tx({ remarks: 'Cleared', amount: 5000, method: 'Fi', category: 'Coral', ts: `${d}T10:00:00` }),
        ),
      ],
    });
    expect(detectRecurring(snap, '2026-08-20')).toHaveLength(0);
  });

  it('drops one that has not been seen for months', () => {
    const snap = makeSnapshot({
      transactions: monthly('Cancelled thing', 300, ['2026-01-05', '2026-02-05', '2026-03-05']),
    });
    expect(detectRecurring(snap, '2026-09-20')).toHaveLength(0);
  });

  /* Grouping is by the WORDS, so a subscription genuinely renamed halfway
     through starts a new group. Nothing in the data connects the two, and
     guessing that they are one thing is how a reminder quotes the wrong
     figure. Only spellings that fold together are the same subscription — and
     of those, the newest spelling is the one shown. */
  it('shows the newest spelling of a name that folds the same', () => {
    const snap = makeSnapshot({
      transactions: [
        ...monthly('CLAUDE SUB', 2312.16, ['2026-06-21']),
        ...monthly('claude sub', 2312.16, ['2026-07-21']),
        ...monthly('Claude Sub', 2312.16, ['2026-08-21']),
      ],
    });
    const hits = detectRecurring(snap, '2026-08-25');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toBe('Claude Sub');
  });
});

describe('nextOccurrence', () => {
  const sub = {
    name: 'Minoxidil', amount: 649.19, everyDays: 30,
    method: 'Fi', category: 'Personal', lastOn: '2026-06-07',
  };

  /* A charge unlogged for two months must still predict the NEXT one. A
     reminder for something due in July helps nobody in September. */
  it('steps past today rather than returning a date already gone', () => {
    // 7 Jun + 30 → 7 Jul → 6 Aug → 5 Sep → 5 Oct, the first past today.
    expect(nextOccurrence(sub, '2026-09-20')).toBe('2026-10-05');
  });

  it('returns the anchor itself when it is still ahead', () => {
    expect(nextOccurrence(sub, '2026-06-01')).toBe('2026-06-07');
  });

  it('cannot spin on a corrupt interval', () => {
    expect(nextOccurrence({ ...sub, everyDays: 0 }, '2026-09-20')).toBeTruthy();
  });
});

describe('subscriptionsFrom', () => {
  it('is empty rather than undefined when nothing is configured', () => {
    expect(subscriptionsFrom({})).toEqual({});
  });
});
