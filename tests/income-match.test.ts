import { describe, expect, it } from 'vitest';
import { matchIncome } from '@/lib/income-match';

const rec = (remarks: string, amount = 100, day = '2026-01-28') => ({ day, amount, account: 'Fi', source: 'Credit Return', remarks });
const row = (remarks: string, amount = 100, day = '2026-01-28') => ({ day, amount, account: 'Fi', remarks });

describe('received money already on file', () => {
  it('matches the same sender exactly, and one recorded entry answers for one row only', () => {
    const recorded = [rec('v.arshadali@oksbi'), rec('akkalirshad@okicici'), rec('asifplmk977-3@okicici'), rec('ahiqpktr@okaxis')];
    const out = matchIncome(
      [row('v.arshadali@oksbi'), row('akkalirshad@okicici'), row('akkalirshad@okicici'), row('v.arshadali@oksbi')],
      recorded,
    );
    expect(out.map((m) => m?.level ?? null)).toEqual(['exact', 'exact', 'likely', 'likely']);
    // The second copies are only "likely", against entries from OTHER senders.
    expect(out[2]!.existing.remarks).not.toBe('akkalirshad@okicici');
    expect(out[3]!.existing.remarks).not.toBe('v.arshadali@oksbi');
  });

  it('never lets one entry match two rows', () => {
    const out = matchIncome([row('a'), row('b'), row('c')], [rec('zzz')]);
    expect(out.filter(Boolean)).toHaveLength(1);
  });

  it('prefers the exact sender over an earlier, looser match', () => {
    const out = matchIncome([row('x'), row('sheya')], [rec('sheya')]);
    expect(out[1]?.level).toBe('exact');
    expect(out[0]).toBeNull();
  });

  it('a different day or amount is not a match', () => {
    expect(matchIncome([row('a', 100, '2026-01-29'), row('a', 101)], [rec('a')])).toEqual([null, null]);
  });
});
