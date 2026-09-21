import { foldForSearch } from '@/lib/search-text';
import { daysBetween, type Day } from '@/lib/time';
import type { Snapshot } from '@/lib/types';

/* ===========================================================================
   What this entry is probably paid from, and probably for.

   Nearly every entry in this ledger repeats one that came before it:
   breakfast on Fi under Food, fuel on Super Money, a shop bill on Scapia
   under Family. Choosing both dropdowns from scratch each time is typing out
   an answer the history already contains.

   THESE ARE SUGGESTIONS, NEVER DEFAULTS, and that is deliberate rather than
   timid. The voice parser in this app refuses to fill a payment method it is
   not sure of, for a stated reason: a wrong method silently moves debt onto
   the wrong card, and nothing on any screen looks wrong afterwards. A
   pre-selected dropdown is indistinguishable from a chosen one the moment the
   dialog is saved, so what is offered here has to be tapped to take effect.

   RECENCY BEATS VOLUME. A card closed in March should not still be the top
   suggestion in September just because it was used heavily for years. Each
   past entry counts for half as much as one HALF_LIFE_DAYS newer, so a habit
   that has stopped fades on its own rather than needing to be unlearned.
   =========================================================================== */

export type EntryPair = {
  method: string;
  category: string;
  /** Recency-weighted score. Comparable within one list, meaningless outside. */
  weight: number;
  /** How many entries this pairing is drawn from, for honest UI. */
  count: number;
  lastOn: Day;
};

const HALF_LIFE_DAYS = 60;
/** Ignore rows older than this: they say nothing about what happens today. */
const LOOKBACK_DAYS = 400;
/** Separates the two halves of a map key; neither field can contain it. */
const SEP = '||';

function decay(age: number): number {
  return Math.pow(0.5, Math.max(0, age) / HALF_LIFE_DAYS);
}

/**
 * The method-and-category pairings used most, recency-weighted.
 *
 * Pairings rather than two separate lists: "Fi" and "Food" are each common,
 * but offering them independently would suggest combinations never actually
 * used. What repeats is the pair.
 */
export function frequentPairs(snapshot: Snapshot, today: Day, limit = 4): EntryPair[] {
  const sums = new Map<string, EntryPair>();

  for (const t of snapshot.transactions) {
    if (t.deleted || !t.ts || t.amount == null) continue;
    if (!t.method || !t.category) continue;
    /* A bill payment is its own flow with its own shape. Suggesting one here
       would put "paying the Coral bill" a single tap away from an ordinary
       purchase, which is the kind of neighbouring mistake nobody notices. */
    if (t.kind === 'card_payment') continue;

    const day = t.ts.slice(0, 10);
    const age = daysBetween(day, today);
    if (age < 0 || age > LOOKBACK_DAYS) continue;

    const key = `${t.method}${SEP}${t.category}`;
    const cur = sums.get(key) ?? {
      method: t.method, category: t.category, weight: 0, count: 0, lastOn: day,
    };
    cur.weight += decay(age);
    cur.count += 1;
    if (day > cur.lastOn) cur.lastOn = day;
    sums.set(key, cur);
  }

  return [...sums.values()].sort((a, b) => b.weight - a.weight).slice(0, limit);
}

/**
 * How a remark has been filed before.
 *
 * Evidence, not inference: it only answers for wording that has been used,
 * and it answers with what was actually chosen then. A remark filed two ways
 * returns the more recent habit, weighted the same way as everything else —
 * which is what lets a re-categorisation stick rather than being argued with
 * by its own history.
 */
export function pairForRemark(
  snapshot: Snapshot,
  remark: string,
  today: Day,
): EntryPair | null {
  const q = foldForSearch(remark);
  if (q.length < 2) return null;

  const sums = new Map<string, EntryPair>();

  for (const t of snapshot.transactions) {
    if (t.deleted || !t.ts || !t.method || !t.category) continue;
    if (foldForSearch(t.remarks ?? '') !== q) continue;

    const day = t.ts.slice(0, 10);
    const age = daysBetween(day, today);
    if (age < 0 || age > LOOKBACK_DAYS) continue;

    const key = `${t.method}${SEP}${t.category}`;
    const cur = sums.get(key) ?? {
      method: t.method, category: t.category, weight: 0, count: 0, lastOn: day,
    };
    cur.weight += decay(age);
    cur.count += 1;
    if (day > cur.lastOn) cur.lastOn = day;
    sums.set(key, cur);
  }

  return [...sums.values()].sort((a, b) => b.weight - a.weight)[0] ?? null;
}
