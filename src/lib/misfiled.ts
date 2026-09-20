import { cycleOf, type Cycle, type CycleOverrides } from '@/lib/cycles';
import { cardColor } from '@/lib/statement';
import { couldBelongToCard, type AppEntry } from '@/lib/statement-match';
import { endOfDay, startOfDay } from '@/lib/time';
import { isCard, type Card, type Snapshot } from '@/lib/types';

/* ===========================================================================
   Everything in a cycle that was paid with something else.

   A spend put on the wrong card is invisible exactly where you would notice
   it: it never shows on the statement you are checking, because that view
   filters by the card it was filed under. These are the rows that could be the
   missing one.

   Built here rather than in a page because two pages need the same answer —
   the statement checker and the card's own detail — and the filter carries
   real financial semantics. Two copies of it would be two things to keep true
   about which rows may be re-filed onto a card.
   =========================================================================== */

/** An entry in the window filed against some OTHER payment method. */
export type MisfiledCandidate = AppEntry & {
  method: string;
  category: string;
  /** The statement this entry is on TODAY, on whichever card it is filed
      against — null when the method is not a card and has no cycle at all. */
  fromStatement: string | null;
  /** That card's own themed colour — null for a non-card method, which has no
      card and so no colour to show. */
  methodColor: string | null;
};

export type CycleEntries = {
  /** Paid with something else — the rows that could be the missing one. */
  elsewhere: MisfiledCandidate[];
  /** Already counted against this card in this window. */
  own: MisfiledCandidate[];
};

export function misfiledCandidates(
  snap: Snapshot,
  card: Card,
  cycle: Cycle,
  overrides: CycleOverrides = {},
): CycleEntries {
  // A full Card structurally satisfies CycleCard, so one map serves both the
  // cycle maths and the colour lookup.
  const cardsByName = new Map(snap.cards.map((c) => [c.name, c]));

  /* EVERY CARD BILLS ON A DIFFERENT DAY — Edge on the 6th, Scapia the 14th,
     One Card the 22nd. So an entry sitting on Scapia is on a Scapia statement
     with its own dates, and moving it here does not just change a label: it
     takes the charge off one bill and puts it on another cut on a different
     day. A non-card method has no statement at all, which is itself worth
     showing rather than leaving blank. */
  const statementOf = (method: string, ts: string): string | null => {
    if (!isCard(method)) return null;
    const c = cardsByName.get(method);
    return c ? cycleOf(c, ts, overrides).statementEnd : null;
  };

  /* Resolved here rather than handed to a client component as `cardColor`
     itself: a function is not serialisable across that boundary, and passing
     one fails at runtime with nothing for the typechecker to catch. */
  const colorOf = (method: string): string | null => {
    const c = cardsByName.get(method);
    return c ? cardColor(c.slot) : null;
  };

  const lo = startOfDay(cycle.cycleStart);
  const hi = endOfDay(cycle.periodEnd);

  const rows = (keep: (t: Snapshot['transactions'][number]) => boolean): MisfiledCandidate[] =>
    snap.transactions
      .filter(
        (t) => !t.deleted && t.ts && t.amount != null && keep(t) && t.ts >= lo && t.ts <= hi,
      )
      .map((t) => ({
        id: t.id,
        ts: t.ts!,
        day: t.ts!.slice(0, 10),
        amount: t.amount ?? 0,
        description: t.remarks || t.category,
        category: t.category,
        direction: t.cardDirection === 'debt-' ? ('credit' as const) : ('debit' as const),
        verified: t.verified,
        method: t.method,
        methodColor: colorOf(t.method),
        fromStatement: statementOf(t.method, t.ts!),
      }))
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));

  return {
    elsewhere: rows((t) => couldBelongToCard(t, card.name)),
    /* The card's OWN entries for the same window — what is already on this
       bill. Same shape and same builder, so the two can be shown in one list
       without a second set of rules about how a row is described. */
    own: rows((t) => t.cardAffected === card.name),
  };
}
