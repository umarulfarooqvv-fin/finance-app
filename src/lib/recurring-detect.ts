import { addDays, daysBetween, type Day } from '@/lib/time';
import { foldForSearch } from '@/lib/search-text';
import type { Snapshot } from '@/lib/types';

/* ===========================================================================
   Finding the charges that come back every month.

   A subscription is not a record in this app. The Claude subscription, the
   Minoxidil, the KSEB bill — each is an ordinary entry that happens to be
   typed again every month, and nothing connects this month's to last
   month's except the words in its remarks.

   That is enough to find them. A remark that has appeared three or more times
   at roughly monthly spacing for roughly the same amount is a standing
   commitment whether or not anyone has declared it one.

   IT ONLY EVER PROPOSES. Detection decides what to SHOW someone, never what
   to remind them about: a false positive that becomes a silent monthly alert
   is how a reminder system trains its owner to ignore it. The confirmed list
   lives in app_config and is put there by a person.

   Deliberately NOT here: EMIs and card bills. Both are already modelled — an
   EMI by its n/m counter, a bill by its cycle — and re-deriving them from
   coincidence would give two answers to one question.
   =========================================================================== */

export type RecurringCandidate = {
  /** The remark as most recently written, which is what a person recognises. */
  name: string;
  /** Matching key: folded, so a curled apostrophe is the same subscription. */
  key: string;
  method: string;
  category: string;
  /** Median of the observed amounts — resistant to one odd month. */
  amount: number;
  /** Median days between charges, rounded. ~30 for monthly. */
  everyDays: number;
  seen: number;
  lastOn: Day;
  /** Where the next one is expected, from the last date plus the interval. */
  nextOn: Day;
};

/* Thresholds, and why each is where it is.

   THREE occurrences, not two: two of anything look periodic, and a pair of
   unrelated charges a month apart would propose a subscription that does not
   exist. Three is the fewest that establishes a rhythm.

   20 to 45 DAYS covers monthly billing however the calendar falls — a 28-day
   February against a 31-day March — without swallowing fortnightly or
   quarterly charges, which are a different thing and would predict the wrong
   date if called monthly.

   A quarter of the amount: a subscription whose price changes by more than
   that is not the same commitment any more, and a reminder quoting the old
   figure is worse than none. */
const MIN_SEEN = 3;
const MIN_GAP = 20;
const MAX_GAP = 45;
const AMOUNT_TOLERANCE = 0.25;
/* Stop proposing something last seen a long time ago. A cancelled
   subscription should fall off by itself rather than need dismissing. */
const STALE_AFTER_DAYS = 75;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Charges that look like standing commitments, most recent first.
 *
 * `today` anchors staleness and the predicted next date, so the same snapshot
 * read on two days gives two answers — which is correct, and why it is a
 * parameter rather than a clock read inside.
 */
export function detectRecurring(snapshot: Snapshot, today: Day): RecurringCandidate[] {
  const groups = new Map<
    string,
    { name: string; method: string; category: string; days: Day[]; amounts: number[] }
  >();

  for (const t of snapshot.transactions) {
    if (t.deleted || !t.ts || t.amount == null || t.amount <= 0) continue;
    // A bill payment repeats every month by definition and is already a bill.
    if (t.kind !== 'spend') continue;
    // An instalment is an EMI, which the EMI tracker owns.
    if (t.tags.emi) continue;
    const remarks = (t.remarks ?? '').trim();
    if (!remarks) continue;

    const key = foldForSearch(remarks);
    if (!key) continue;
    const g = groups.get(key) ?? {
      name: remarks, method: t.method, category: t.category, days: [], amounts: [],
    };
    const day = t.ts.slice(0, 10);
    // Newest wins the display name, method and category: a renamed or re-filed
    // subscription should be proposed as it is NOW, not as it started.
    if (g.days.length === 0 || day >= g.days[g.days.length - 1]!) {
      g.name = remarks; g.method = t.method; g.category = t.category;
    }
    g.days.push(day);
    g.amounts.push(t.amount);
    groups.set(key, g);
  }

  const out: RecurringCandidate[] = [];

  for (const [key, g] of groups) {
    if (g.days.length < MIN_SEEN) continue;

    const sorted = [...g.days]
      .map((d, i) => ({ day: d, amount: g.amounts[i]! }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

    /* THE CURRENT RUN, not the whole history.

       The question is whether something recurs NOW, so this walks back from
       the most recent charge for as long as the spacing holds and judges only
       that stretch. Testing every gap ever recorded disqualified a live
       subscription for one lapse years ago — Minoxidil has been monthly since
       March and was rejected for a 62-day gap in January. A run that has ended
       is still excluded, by the staleness check below: it is the LAST charge
       that has to be recent, and a run that stopped has an old one. */
    let start = sorted.length - 1;
    const gaps: number[] = [];
    while (start > 0) {
      const gap = daysBetween(sorted[start - 1]!.day, sorted[start]!.day);
      if (gap < MIN_GAP || gap > MAX_GAP) break;
      gaps.unshift(gap);
      start -= 1;
    }
    const run = sorted.slice(start);
    if (run.length < MIN_SEEN || gaps.length === 0) continue;

    const days = run.map((r) => r.day);
    const everyDays = Math.round(median(gaps));
    if (everyDays < MIN_GAP || everyDays > MAX_GAP) continue;

    /* Amounts judged over the same run, for the same reason: what a charge
       cost two prices ago says nothing about what to expect next month. */
    const runAmounts = run.map((r) => r.amount);
    const amount = median(runAmounts);
    if (amount <= 0) continue;
    if (runAmounts.some((a) => Math.abs(a - amount) > amount * AMOUNT_TOLERANCE)) continue;

    const lastOn = days[days.length - 1]!;
    if (daysBetween(lastOn, today) > STALE_AFTER_DAYS) continue;

    out.push({
      name: g.name,
      key,
      method: g.method,
      category: g.category,
      amount: Math.round(amount * 100) / 100,
      everyDays,
      seen: days.length,
      lastOn,
      nextOn: addDays(lastOn, everyDays),
    });
  }

  return out.sort((a, b) => (a.lastOn < b.lastOn ? 1 : a.lastOn > b.lastOn ? -1 : b.seen - a.seen));
}

/* --- What a person has confirmed ----------------------------------------- */

export type ConfirmedSubscription = {
  name: string;
  amount: number;
  everyDays: number;
  method: string;
  category: string;
  /** Anchor date; the next occurrence is stepped forward from here. */
  lastOn: Day;
};

export type Subscriptions = Record<string, ConfirmedSubscription>;

/** The confirmed list, keyed by folded remark. Same shape as cycleOverridesFrom. */
export function subscriptionsFrom(config: Record<string, unknown>): Subscriptions {
  return (config['subscriptions'] as Subscriptions | undefined) ?? {};
}

/**
 * When a confirmed subscription next falls due, stepped forward past `today`.
 *
 * Stepped rather than computed once, because a charge that has not been logged
 * for two months should still predict the NEXT one rather than a date already
 * in the past — a reminder for something that was due in July helps nobody.
 */
export function nextOccurrence(sub: ConfirmedSubscription, today: Day): Day {
  let d = sub.lastOn;
  const step = Math.max(1, sub.everyDays);
  // Bounded: a corrupt everyDays must not spin.
  for (let i = 0; i < 400 && d < today; i++) d = addDays(d, step);
  return d;
}
