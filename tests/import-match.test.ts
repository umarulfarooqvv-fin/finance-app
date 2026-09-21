import { describe, expect, it } from 'vitest';
import { matchAgainstLedger, type MatchableRow } from '@/lib/import-match';
import { makeSnapshot, tx } from './helpers';

const row = (over: Partial<MatchableRow> = {}): MatchableRow => ({
  line: 1,
  day: '2026-09-14',
  amount: 250,
  method: 'Fi',
  category: 'Food',
  remarks: 'Breakfast',
  ...over,
});

const recorded = (over: Parameters<typeof tx>[0] = {}) =>
  tx({ ts: '2026-09-14T08:00:00', amount: 250, method: 'Fi', category: 'Food', remarks: 'Breakfast', ...over });

const levels = (rows: MatchableRow[], transactions: ReturnType<typeof tx>[]) => {
  const m = matchAgainstLedger(rows, makeSnapshot({ transactions }));
  return rows.map((r) => m.get(r.line)!.level);
};

describe('matchAgainstLedger', () => {
  it('calls it exact when everything agrees', () => {
    expect(levels([row()], [recorded()])).toEqual(['exact']);
  });

  it('ignores casing and curled punctuation when comparing wording', () => {
    expect(levels([row({ remarks: 'BREAKFAST' })], [recorded({ remarks: 'breakfast' })]))
      .toEqual(['exact']);
  });

  /* THE CORRECTION THAT MATTERS. A bank names an expense the way the MERCHANT
     does — "Max Retail 4617" where the ledger says "Shirts (Banglore Trip)" —
     so requiring the wording to agree made the strong tier unreachable for
     the one source it exists to read. Same day, same amount, same account IS
     the same expense. */
  it('calls it exact when the wording differs but day, amount and account agree', () => {
    expect(levels([row({ remarks: 'MAX RETAIL 4617' })], [recorded({ remarks: 'Shirts' })]))
      .toEqual(['exact']);
    // The category is often the very thing the import is filling in.
    expect(levels([row({ category: '' })], [recorded({ category: 'Food' })]))
      .toEqual(['exact']);
  });

  /* A different account on the same day for the same amount is a different
     payment, and the app must not untick it. */
  it('drops to likely when the account differs', () => {
    expect(levels([row({ method: 'Edge' })], [recorded({ method: 'Fi' })])).toEqual(['likely']);
  });

  it('drops to likely when the paste does not say which account', () => {
    expect(levels([row({ method: '' })], [recorded({ method: 'Fi' })])).toEqual(['likely']);
  });

  it('calls it new when nothing on that day matches the amount', () => {
    expect(levels([row({ amount: 251 })], [recorded()])).toEqual(['new']);
    expect(levels([row({ day: '2026-09-15' })], [recorded()])).toEqual(['new']);
  });

  /* The rule the sheet sync already documents: two identical amounts on one
     day are legitimate, and the live data contains such pairs. */
  it('pairs duplicates off one for one, and the extra is new', () => {
    const two = [row({ line: 1 }), row({ line: 2 })];
    expect(levels(two, [recorded()])).toEqual(['exact', 'new']);

    const three = [row({ line: 1 }), row({ line: 2 }), row({ line: 3 })];
    expect(levels(three, [recorded(), recorded()])).toEqual(['exact', 'exact', 'new']);
  });

  /* One recorded entry cannot be the duplicate of two different pasted rows,
     however they were matched. */
  it('does not let one entry be claimed twice across the two tiers', () => {
    const rows = [
      row({ line: 1, method: '' }),  // likely — no account, claims the entry
      row({ line: 2 }),              // exact would have claimed it too
    ];
    const got = levels(rows, [recorded()]);
    expect(got.filter((l) => l !== 'new')).toHaveLength(1);
  });

  it('never matches a deleted entry', () => {
    expect(levels([row()], [recorded({ deleted: true })])).toEqual(['new']);
  });

  it('reports which entry it matched, so it can be shown', () => {
    const m = matchAgainstLedger([row()], makeSnapshot({ transactions: [recorded({ remarks: 'Breakfast' })] }));
    expect(m.get(1)!.existing?.remarks).toBe('Breakfast');
    expect(m.get(1)!.existing?.id).toBeTruthy();
  });

  it('leaves `existing` null for a genuinely new row', () => {
    const m = matchAgainstLedger([row({ amount: 9999 })], makeSnapshot({ transactions: [recorded()] }));
    expect(m.get(1)).toEqual({ level: 'new', existing: null });
  });

  /* A row dated in March cannot be a duplicate of one pasted for September,
     so only the window the paste covers is scanned. */
  it('ignores entries outside the pasted date range', () => {
    expect(levels([row()], [recorded({ ts: '2026-03-14T08:00:00' })])).toEqual(['new']);
  });

  it('copes with an empty paste and an empty ledger', () => {
    expect(matchAgainstLedger([], makeSnapshot({})).size).toBe(0);
    expect(levels([row()], [])).toEqual(['new']);
  });

  /* A row imported unfiled still has to be findable if the same paste is run
     twice — the category is not part of the strong tier, so it does not have
     to have been filled in first. */
  it('matches a row that went in unfiled', () => {
    expect(levels([row({ category: '' })], [recorded({ category: '' })])).toEqual(['exact']);
  });
});
