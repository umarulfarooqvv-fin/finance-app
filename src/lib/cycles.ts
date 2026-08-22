import {
  addDays, dayInMonth, dayOf, daysBetween, endOfDay, shiftMonth, startOfDay,
  type Day, type Instant,
} from '@/lib/time';
import type { Card } from '@/lib/types';

/* ===========================================================================
   Statement cycle geometry (spec §3.1).

   A card bills on a fixed day of the month. The cycle that just closed runs
   from the day after the previous bill date up to and including the most
   recent one. Anything charged after that is unbilled — real debt, but not yet
   demanded.

           prevBill        thisBill              now
              |               |                   |
              +---- cycle ----+---- unbilled -----+
           cycleStart     statementEnd
                              +---- graceDays ----> dueDate
   =========================================================================== */

export type Cycle = {
  /** First day of the closed statement period. */
  cycleStart: Day;
  /** The day the statement was generated (inclusive). */
  statementEnd: Day;
  /** When that statement has to be paid. */
  dueDate: Day;
  /** The next bill date, i.e. when the currently-unbilled spend closes. */
  nextStatementEnd: Day;
};

/**
 * The most recent cycle to have closed as of `today`.
 *
 * Day-of-month values are clamped to the month's real length, so a card that
 * bills on the 31st bills on 28-Feb rather than rolling into March.
 */
export function cycleFor(card: Pick<Card, 'billDate' | 'graceDays' | 'dueDay' | 'dueCycle'>, today: Day): Cycle {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));

  // Walk back one month if this month's bill date has not arrived yet.
  let end = dayInMonth(y, m, card.billDate);
  let endY = y;
  let endM = m;
  if (end > today) {
    const prev = shiftMonth(y, m, -1);
    endY = prev.y;
    endM = prev.m;
    end = dayInMonth(endY, endM, card.billDate);
  }

  const prevMonth = shiftMonth(endY, endM, -1);
  const cycleStart = addDays(dayInMonth(prevMonth.y, prevMonth.m, card.billDate), 1);

  // Prefer the card's real due day when known; fall back to grace days.
  let dueDate: Day;
  if (card.dueDay) {
    const dm = card.dueCycle === 'next' ? shiftMonth(endY, endM, 1) : { y: endY, m: endM };
    dueDate = dayInMonth(dm.y, dm.m, card.dueDay);
  } else {
    dueDate = addDays(end, card.graceDays);
  }

  const next = shiftMonth(endY, endM, 1);
  return {
    cycleStart,
    statementEnd: end,
    dueDate,
    nextStatementEnd: dayInMonth(next.y, next.m, card.billDate),
  };
}

/** Cycle boundaries as inclusive Instant bounds, ready to compare against ts. */
export function cycleBounds(c: Cycle): { start: Instant; end: Instant } {
  return { start: startOfDay(c.cycleStart), end: endOfDay(c.statementEnd) };
}

export type DueStatus = 'paid' | 'safe' | 'due-soon' | 'overdue';

/** Days until the bill is due; negative once it is past. */
export function daysUntilDue(c: Cycle, today: Day): number {
  return daysBetween(today, c.dueDate);
}

/**
 * Bill status. `dueSoonDays` is configurable (spec suggests 5).
 * A cleared bill is 'paid' regardless of the date — nothing is owed.
 */
export function dueStatus(remainingDue: number, daysLeft: number, dueSoonDays = 5): DueStatus {
  if (remainingDue <= 0.005) return 'paid';
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= dueSoonDays) return 'due-soon';
  return 'safe';
}

/**
 * Walk backwards over the last `count` closed cycles, most recent first.
 * Used by the per-card history view and by trend reconstruction.
 */
export function recentCycles(
  card: Pick<Card, 'billDate' | 'graceDays' | 'dueDay' | 'dueCycle'>,
  today: Day,
  count: number,
): Cycle[] {
  const out: Cycle[] = [];
  let cursor = today;
  for (let i = 0; i < count; i++) {
    const c = cycleFor(card, cursor);
    out.push(c);
    // Step to the day before this cycle started and ask again.
    cursor = addDays(c.cycleStart, -1);
  }
  return out;
}

/** The cycle a given instant falls into, for assigning a transaction. */
export function cycleOf(
  card: Pick<Card, 'billDate' | 'graceDays' | 'dueDay' | 'dueCycle'>,
  ts: Instant,
): Cycle {
  return cycleFor(card, dayOf(ts));
}
