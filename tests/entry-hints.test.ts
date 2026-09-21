import { describe, expect, it } from 'vitest';
import { frequentPairs, pairForRemark } from '@/lib/entry-hints';
import { makeSnapshot, tx } from './helpers';

const TODAY = '2026-09-21';

const rows = (specs: { method: string; category: string; day: string; remarks?: string }[]) =>
  specs.map((s) =>
    tx({
      method: s.method,
      category: s.category,
      remarks: s.remarks ?? '',
      amount: 100,
      ts: `${s.day}T10:00:00`,
    }),
  );

describe('frequentPairs', () => {
  it('offers the pairing used most, not two separate lists', () => {
    const snap = makeSnapshot({
      transactions: rows([
        { method: 'Fi', category: 'Food', day: '2026-09-18' },
        { method: 'Fi', category: 'Food', day: '2026-09-19' },
        { method: 'Scapia', category: 'Family', day: '2026-09-20' },
      ]),
    });
    const [top] = frequentPairs(snap, TODAY);
    expect(top).toMatchObject({ method: 'Fi', category: 'Food', count: 2 });
  });

  /* A habit that stopped should fade on its own rather than needing to be
     unlearned: a card used heavily until March is not the answer in September. */
  it('lets recency beat sheer volume', () => {
    const old = Array.from({ length: 30 }, (_, i) => ({
      method: 'One Card', category: 'Personal', day: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    }));
    const recent = Array.from({ length: 6 }, (_, i) => ({
      method: 'Fi', category: 'Food', day: `2026-09-${String(10 + i).padStart(2, '0')}`,
    }));
    const snap = makeSnapshot({ transactions: rows([...old, ...recent]) });

    const top = frequentPairs(snap, TODAY)[0]!;
    expect(top.method).toBe('Fi');
    // The faded habit is still offered, just not first.
    expect(frequentPairs(snap, TODAY).some((p) => p.method === 'One Card')).toBe(true);
  });

  /* Paying a card bill a tap away from an ordinary purchase is the kind of
     neighbouring mistake nobody notices afterwards. */
  it('never suggests a card bill payment', () => {
    const snap = makeSnapshot({
      transactions: rows([
        { method: 'Fi', category: 'Coral', day: '2026-09-19', remarks: 'Cleared' },
        { method: 'Fi', category: 'Coral', day: '2026-09-20', remarks: 'Cleared' },
        { method: 'Fi', category: 'Food', day: '2026-09-20' },
      ]),
    });
    const pairs = frequentPairs(snap, TODAY);
    expect(pairs.every((p) => p.category !== 'Coral')).toBe(true);
    expect(pairs).toHaveLength(1);
  });

  it('ignores rows too old to say anything about today', () => {
    const snap = makeSnapshot({
      transactions: rows([{ method: 'Fi', category: 'Food', day: '2024-01-01' }]),
    });
    expect(frequentPairs(snap, TODAY)).toHaveLength(0);
  });

  it('ignores entries dated in the future', () => {
    const snap = makeSnapshot({
      transactions: rows([{ method: 'Fi', category: 'Food', day: '2026-12-01' }]),
    });
    expect(frequentPairs(snap, TODAY)).toHaveLength(0);
  });

  it('returns nothing rather than inventing a pairing', () => {
    expect(frequentPairs(makeSnapshot({}), TODAY)).toEqual([]);
  });

  it('honours the limit it is given', () => {
    const snap = makeSnapshot({
      transactions: rows([
        { method: 'Fi', category: 'Food', day: '2026-09-18' },
        { method: 'Scapia', category: 'Family', day: '2026-09-18' },
        { method: 'Coral', category: 'Personal', day: '2026-09-18' },
        { method: 'Cash', category: 'Fuel', day: '2026-09-18' },
      ]),
    });
    expect(frequentPairs(snap, TODAY, 2)).toHaveLength(2);
  });
});

describe('pairForRemark', () => {
  const snap = makeSnapshot({
    transactions: rows([
      { method: 'Fi', category: 'Food', day: '2026-09-10', remarks: 'Breakfast' },
      { method: 'Fi', category: 'Food', day: '2026-09-15', remarks: 'breakfast' },
      { method: 'Scapia', category: 'Family', day: '2026-09-16', remarks: 'Shope bill' },
    ]),
  });

  it('answers with how that exact wording was filed', () => {
    expect(pairForRemark(snap, 'Breakfast', TODAY)).toMatchObject({
      method: 'Fi', category: 'Food', count: 2,
    });
  });

  it('matches regardless of case or curled punctuation', () => {
    expect(pairForRemark(snap, 'BREAKFAST', TODAY)?.category).toBe('Food');
  });

  /* Evidence, not inference. A remark never used before has no history to
     report, and guessing from a partial match is how a wrong method arrives
     looking like a considered one. */
  it('says nothing about wording it has not seen', () => {
    expect(pairForRemark(snap, 'Break', TODAY)).toBeNull();
    expect(pairForRemark(snap, 'Something new', TODAY)).toBeNull();
  });

  it('ignores a query too short to mean anything', () => {
    expect(pairForRemark(snap, 'a', TODAY)).toBeNull();
    expect(pairForRemark(snap, '', TODAY)).toBeNull();
  });

  /* A re-categorisation has to stick rather than be argued with by its own
     history, so the newer filing wins. */
  it('follows the more recent filing when one remark was filed two ways', () => {
    const changed = makeSnapshot({
      transactions: rows([
        { method: 'Fi', category: 'Personal', day: '2026-03-01', remarks: 'Minoxidil' },
        { method: 'Fi', category: 'Personal', day: '2026-04-01', remarks: 'Minoxidil' },
        { method: 'ICICI', category: 'Medicine', day: '2026-09-15', remarks: 'Minoxidil' },
      ]),
    });
    expect(pairForRemark(changed, 'Minoxidil', TODAY)).toMatchObject({
      method: 'ICICI', category: 'Medicine',
    });
  });
});
