import { round2 } from '@/lib/analytics';
import { creditLedger } from '@/lib/credit';
import { daysBetween, type Day } from '@/lib/time';
import type { Snapshot } from '@/lib/types';

/* ===========================================================================
   What is worth chasing, and what is quietly going cold.

   The Ledgers page already says who owes what. What it cannot say is which of
   those balances is DRIFTING: a large one being repaid steadily needs no
   attention, and a small one untouched since last winter is the one that
   turns into money nobody mentions again.

   So this ranks by neglect rather than by size. Size alone puts the healthiest
   arrangement at the top of the list, which is how the stale ones stay at the
   bottom of it.

   NOTHING HERE IS AN ACCUSATION. A repayment is only known when it was
   recorded as income or as a Credit Return row, so cash handed back and never
   logged still reads as outstanding. Every figure means "not recorded as
   repaid", never "certainly unpaid", and the labels say so.
   =========================================================================== */

export type RecoveryFlag =
  /** Lent, and not one rupee recorded back. */
  | 'nothing-back'
  /** Something came back, but nothing recently. */
  | 'stalled'
  /** Repayments are still arriving. */
  | 'moving';

export type RecoveryPerson = {
  person: string;
  given: number;
  repaid: number;
  outstanding: number;
  /** Share of what was lent that has come back, 0 to 1. */
  recovered: number;
  /** Days since anything at all was recorded against this person. */
  quietFor: number;
  /** Days since the oldest still-unrepaid lending was made. */
  oldestAge: number;
  flag: RecoveryFlag;
};

export type Recovery = {
  outstanding: number;
  people: RecoveryPerson[];
  /** Outstanding on balances with no movement for STALE_DAYS or more. */
  stale: number;
  staleCount: number;
  /** Money that arrived looking like a repayment but names nobody known. */
  unattached: { amount: number; count: number };
};

/* Six weeks. Long enough that a slow repayment is not nagged about, short
   enough that a balance cannot quietly pass a season unnoticed. */
const STALE_DAYS = 45;

export function recovery(snapshot: Snapshot, today: Day): Recovery {
  const ledger = creditLedger(snapshot);

  const people: RecoveryPerson[] = ledger.people
    .filter((p) => p.outstanding > 0.005)
    .map((p) => {
      const lastDay = p.lastActivity ? p.lastActivity.slice(0, 10) : null;
      const quietFor = lastDay ? Math.max(0, daysBetween(lastDay, today)) : 0;

      const openLendings = p.lendings.filter((l) => l.outstanding > 0.005);
      const oldest = openLendings.reduce<string | null>(
        (a, l) => (a === null || l.ts < a ? l.ts : a),
        null,
      );
      const oldestAge = oldest ? Math.max(0, daysBetween(oldest.slice(0, 10), today)) : 0;

      const recovered = p.given > 0 ? p.repaid / p.given : 0;

      const flag: RecoveryFlag =
        p.repaid <= 0.005 ? 'nothing-back' : quietFor >= STALE_DAYS ? 'stalled' : 'moving';

      return {
        person: p.person,
        given: round2(p.given),
        repaid: round2(p.repaid),
        outstanding: round2(p.outstanding),
        recovered,
        quietFor,
        oldestAge,
        flag,
      };
    });

  /* NEGLECT FIRST, THEN SIZE — in that order, and neither alone.

     Sorting by size alone puts a healthy, actively-repaying arrangement at the
     top and leaves the forgotten ones at the bottom. Sorting by silence alone
     is no better: against real data it put a 19-rupee balance quiet for two
     years above a six-figure one, because nothing about 742 days says whether
     the sum is worth a phone call.

     So the stale ones come first as a group, and within each group the largest
     leads. That is the order someone would actually work down. */
  people.sort((a, b) => {
    const aStale = a.quietFor >= STALE_DAYS ? 0 : 1;
    const bStale = b.quietFor >= STALE_DAYS ? 0 : 1;
    return aStale - bStale || b.outstanding - a.outstanding;
  });

  const staleRows = people.filter((p) => p.quietFor >= STALE_DAYS);

  return {
    outstanding: round2(people.reduce((a, p) => a + p.outstanding, 0)),
    people,
    stale: round2(staleRows.reduce((a, p) => a + p.outstanding, 0)),
    staleCount: staleRows.length,
    unattached: {
      amount: round2(ledger.unattached.reduce((a, u) => a + u.amount, 0)),
      count: ledger.unattached.length,
    },
  };
}

export { STALE_DAYS };
