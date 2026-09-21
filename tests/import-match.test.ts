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

  /* A statement describes an expense differently from the person who lived
     it, and the category is often the thing the import is correcting. */
  it('calls it likely when the day and amount agree but the wording does not', () => {
    expect(levels([row({ remarks: 'SWIGGY BANGALORE' })], [recorded({ remarks: 'Dinner' })]))
      .toEqual(['likely']);
    expect(levels([row({ category: 'Personal' })], [recorded({ category: 'Food' })]))
      .toEqual(['likely']);
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
      row({ line: 1, remarks: 'Something else' }), // likely, claims the entry
      row({ line: 2 }),                            // exact would have claimed it too
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

  /* A row imported without a category still has to be findable as a duplicate
     if the same paste is run twice. */
  it('matches a row that has no category or method yet', () => {
    const blank = row({ category: '', method: '' });
    expect(levels([blank], [recorded({ category: '', method: '' })])).toEqual(['exact']);
  });
});
