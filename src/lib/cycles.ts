import {
  addDays, dayInMonth, dayOf, daysBetween, endOfDay, shiftMonth, startOfDay,
  type Day, type Instant,
} from '@/lib/time';
import type { Card, StatementBoundary } from '@/lib/types';

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
  /** First day whose spending appears on this statement. */
  cycleStart: Day;
  /** The day the bank generated the statement. Shown to the user. */
  statementEnd: Day;
  /**
   * Last day whose spending appears on it. Equal to `statementEnd` when the
   * boundary is inclusive, one day earlier when it is exclusive. The debt
   * cut-off uses THIS, never `statementEnd` — they differ by a day exactly
   * when the bank cut the statement before that day's spending posted.
   */
  periodEnd: Day;
  /** Which rule this cycle was computed under. */
  boundary: StatementBoundary;
  /** When that statement has to be paid. */
  dueDate: Day;
  /** The next bill date, i.e. when the currently-unbilled spend closes. */
  nextStatementEnd: Day;
};

/**
 * Per-cycle overrides, stored in app_config under `statement_cycles`.
 *
 *   { "Coral": { "2026-07-25": { boundary: "exclusive", actual: 15333.00 } } }
 *
 * Keyed by the statement DATE, because that is the thing a person reads off a
 * bank statement and can match against.
 */
export type CycleOverride = {
  boundary?: StatementBoundary;
  /** What the bank actually billed, when known. Drives reconciliation. */
  actual?: number;
  note?: string;
};

export type CycleOverrides = Record<string, Record<string, CycleOverride>>;

/** The boundary in force for one statement date. */
export function boundaryFor(
  card: Pick<Card, 'name' | 'statementBoundary'>,
  statementDate: Day,
  overrides: CycleOverrides = {},
): StatementBoundary {
  return overrides[card.name]?.[statementDate]?.boundary ?? card.statementBoundary ?? 'inclusive';
}

/**
 * The most recent cycle to have closed as of `today`.
 *
 * Day-of-month values are clamped to the month's real length, so a card that
 * bills on the 31st bills on 28-Feb rather than rolling into March.
 */
export type CycleCard = Pick<
  Card, 'name' | 'billDate' | 'graceDays' | 'dueDay' | 'dueCycle' | 'statementBoundary'
>;

export function cycleFor(card: CycleCard, today: Day, overrides: CycleOverrides = {}): Cycle {
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

  /* The window is bounded by TWO decisions, not one: this statement's
     boundary sets where it ends, and the PREVIOUS statement's boundary sets
     where it begins. Chaining them is what stops a gap opening.

     If last month's statement excluded its own bill date, that day was never
     billed — so this cycle must start on it, not after it. Reading only this
     cycle's own rule would leave that day on no statement at all, and the
     spending would disappear from both. */
  const prevMonth = shiftMonth(endY, endM, -1);
  const prevStatementDate = dayInMonth(prevMonth.y, prevMonth.m, card.billDate);

  const boundary = boundaryFor(card, end, overrides);
  const prevBoundary = boundaryFor(card, prevStatementDate, overrides);

  const cycleStart = prevBoundary === 'inclusive'
    ? addDays(prevStatementDate, 1)
    : prevStatementDate;

  const periodEnd = boundary === 'inclusive' ? end : addDays(end, -1);

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
    periodEnd,
    boundary,
    dueDate,
    nextStatementEnd: dayInMonth(next.y, next.m, card.billDate),
  };
}

/** Cycle boundaries as inclusive Instant bounds, ready to compare against ts. */
export function cycleBounds(c: Cycle): { start: Instant; end: Instant } {
  return { start: startOfDay(c.cycleStart), end: endOfDay(c.periodEnd) };
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
  card: CycleCard,
  today: Day,
  count: number,
  overrides: CycleOverrides = {},
): Cycle[] {
  const out: Cycle[] = [];
  let cursor = today;
  for (let i = 0; i < count; i++) {
    const c = cycleFor(card, cursor, overrides);
    out.push(c);
    /* Step back from the STATEMENT DATE, not from the period start.
       Under an exclusive previous boundary the period starts ON the previous
       statement date, so stepping back from the start lands before it and
       skips that month entirely — the walk would go July, May, April. */
    cursor = addDays(c.statementEnd, -1);
  }
  return out;
}

/** The cycle a given instant falls into, for assigning a transaction. */
export function cycleOf(card: CycleCard, ts: Instant, overrides: CycleOverrides = {}): Cycle {
  return cycleFor(card, dayOf(ts), overrides);
}
