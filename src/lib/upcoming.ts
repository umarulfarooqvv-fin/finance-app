import { cardStatement } from '@/lib/statement';
import { emiPlans } from '@/lib/emi';
import { nextOccurrence, subscriptionsFrom } from '@/lib/recurring-detect';
import { daysBetween, type Day } from '@/lib/time';
import type { Snapshot } from '@/lib/types';

/* ===========================================================================
   What is coming, across everything that comes round again.

   Three unrelated engines already know their own future: a card knows its due
   date, an EMI knows its next instalment, a confirmed subscription knows its
   interval. What nobody knew was all three at once, in date order, which is
   the only form in which a reminder can be written.

   ONE RULE ABOVE ALL: a reminder must be worth reading. A notification for a
   bill of zero, or for a bill already paid, is how a person learns to dismiss
   this app's notifications without looking — and then misses the one that
   mattered. So a due with nothing owing is not a due, and every caller here
   gets the same list rather than each deciding for itself what counts.

   Pure, like the rest of the engine: `today` is a parameter, so the same
   snapshot can be asked what next Tuesday looks like.
   =========================================================================== */

export type DueKind = 'bill' | 'emi' | 'subscription';

export type Due = {
  kind: DueKind;
  /** Stable across days, so a reminder can be sent once and not again. */
  id: string;
  title: string;
  /** Null when the amount is not knowable in advance. */
  amount: number | null;
  on: Day;
  daysAway: number;
  /** The card it lands on, where there is one. */
  card: string | null;
};

/** Below this, a figure is zero and not worth anyone's attention. */
const EPSILON = 0.005;

export function upcomingDues(
  snapshot: Snapshot,
  today: Day,
  horizonDays: number,
): Due[] {
  const out: Due[] = [];
  const within = (d: Day) => {
    const away = daysBetween(today, d);
    return away >= 0 && away <= horizonDays ? away : null;
  };

  /* --- Card bills ------------------------------------------------------- */
  for (const card of snapshot.cards) {
    if (!card.active) continue;
    const st = cardStatement(snapshot, card, today);
    // Nothing owed is nothing to remind about, whatever the calendar says.
    if (st.remainingDueBill <= EPSILON) continue;
    const away = within(st.cycle.dueDate);
    if (away === null) continue;
    out.push({
      kind: 'bill',
      id: `bill:${card.name}:${st.cycle.statementEnd}`,
      title: `${card.name} bill`,
      amount: st.remainingDueBill,
      on: st.cycle.dueDate,
      daysAway: away,
      card: card.name,
    });
  }

  /* --- EMI instalments -------------------------------------------------- */
  for (const plan of emiPlans(snapshot, today)) {
    if (plan.complete || !plan.nextDue) continue;
    const away = within(plan.nextDue);
    if (away === null) continue;
    out.push({
      kind: 'emi',
      id: `emi:${plan.name}:${plan.nextDue}`,
      title: `${plan.name} · instalment ${plan.paidCount + 1} of ${plan.months}`,
      amount: plan.instalmentAmount > EPSILON ? plan.instalmentAmount : null,
      on: plan.nextDue,
      daysAway: away,
      card: plan.card,
    });
  }

  /* --- Confirmed subscriptions ------------------------------------------
       Only CONFIRMED ones. Detection proposes; a person decides. A guessed
       subscription that becomes a silent monthly alert is exactly how this
       feature would earn its own dismissal. */
  const subs = subscriptionsFrom(snapshot.config);
  for (const [key, sub] of Object.entries(subs)) {
    const on = nextOccurrence(sub, today);
    const away = within(on);
    if (away === null) continue;
    out.push({
      kind: 'subscription',
      id: `sub:${key}:${on}`,
      title: sub.name,
      amount: sub.amount > EPSILON ? sub.amount : null,
      on,
      daysAway: away,
      card: sub.method,
    });
  }

  /* Soonest first, and within a day the biggest figure first — if only one
     line of a notification is read, it should be the one that costs most. */
  return out.sort((a, b) =>
    a.on < b.on ? -1 : a.on > b.on ? 1 : (b.amount ?? 0) - (a.amount ?? 0),
  );
}

/**
 * The dues worth waking someone for today.
 *
 * `leadDays` is how far ahead to warn. Only dues landing EXACTLY on a lead
 * boundary are returned, so a three-day warning fires once on day three and
 * not again on days two, one and zero — which is what turns a reminder into
 * nagging, and nagging into a muted app.
 */
export function duesToNotify(
  snapshot: Snapshot,
  today: Day,
  leadDays: number[],
): Due[] {
  if (leadDays.length === 0) return [];
  const wanted = new Set(leadDays);
  const horizon = Math.max(...leadDays);
  return upcomingDues(snapshot, today, horizon).filter((d) => wanted.has(d.daysAway));
}
