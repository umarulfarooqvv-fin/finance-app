import { entryTags, isSpend } from '@/lib/analytics';
import { round2 } from '@/lib/money';
import { bracketLabels, tagKey } from '@/lib/user-tags';
import type { Snapshot, Transaction } from '@/lib/types';

/* ===========================================================================
   Every tag, and what each one cost.

   "Cost" is told two ways because both get asked. TOTAL is everything moved
   under the tag — lending included, which on a trip is often the friend's
   ticket you paid for. SPENT is consumption only, by the app's one
   definition (analytics.isSpend), so a trip's figure matches what the
   Spending page would say for the same rows.

   Pure: a snapshot in, plain data out.
   =========================================================================== */

export type TagSummary = {
  tag: string;
  count: number;
  /** Everything charged or paid under the tag. */
  total: number;
  /** Consumption only. */
  spent: number;
  /** Money lent to others under the tag. */
  lent: number;
  first: string | null;
  last: string | null;
  /** Entries carrying it as a real [tag]. Zero means it exists only as an old
      "(Trip …)" label, which can be counted but not renamed or removed. */
  stored: number;
  byCategory: { category: string; total: number; count: number }[];
};

/** Live entries with a date and an amount — what a tag can sensibly total. */
const counted = (t: Transaction) => !t.deleted && t.ts != null && t.amount != null;

export function tagSummaries(snapshot: Snapshot): TagSummary[] {
  const groups = new Map<string, { tag: string; rows: Transaction[] }>();
  for (const t of snapshot.transactions) {
    if (!counted(t)) continue;
    for (const tag of entryTags(t)) {
      const k = tagKey(tag);
      const g = groups.get(k) ?? { tag, rows: [] };
      g.rows.push(t);
      groups.set(k, g);
    }
  }

  return [...groups.values()]
    .map(({ tag, rows }) => {
      const days = rows.map((t) => t.ts!.slice(0, 10)).sort();
      const cats = new Map<string, { total: number; count: number }>();
      for (const t of rows) {
        const c = cats.get(t.category) ?? { total: 0, count: 0 };
        c.total += t.amount!;
        c.count += 1;
        cats.set(t.category, c);
      }
      return {
        tag,
        count: rows.length,
        total: round2(rows.reduce((a, t) => a + t.amount!, 0)),
        spent: round2(rows.filter(isSpend).reduce((a, t) => a + t.amount!, 0)),
        lent: round2(rows.filter((t) => t.kind === 'credit_given').reduce((a, t) => a + t.amount!, 0)),
        first: days[0] ?? null,
        last: days.at(-1) ?? null,
        stored: rows.filter((t) => t.userTags.some((u) => tagKey(u) === tagKey(tag))).length,
        byCategory: [...cats.entries()]
          .map(([category, v]) => ({ category, total: round2(v.total), count: v.count }))
          .sort((a, b) => b.total - a.total),
      };
    })
    // Most recent occasion first — the one most likely being looked at.
    .sort((a, b) => (b.last ?? '').localeCompare(a.last ?? '') || b.total - a.total);
}

/** Every tag name in use, most used first — what the tag field offers. */
export function tagNames(snapshot: Snapshot): string[] {
  return tagSummaries(snapshot)
    .slice()
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .map((s) => s.tag);
}

export type LabelSuggestion = { label: string; count: number; total: number };

/**
 * Round-bracket labels used on several entries — "(Banglore Trip)" on 35 —
 * that are probably occasions written before tags existed. Offered, never
 * applied: a bracket is just as often a note ("(GST)", "(Phone for his mom)").
 */
export function labelSuggestions(snapshot: Snapshot, minCount = 3): LabelSuggestion[] {
  // Only REAL tags count as already done: an old "(Trip X)" label is counted
  // as a tag for totals, but it is still a label and still worth converting.
  const known = new Set(snapshot.transactions.flatMap((t) => t.userTags.map(tagKey)));
  const sums = new Map<string, LabelSuggestion>();
  for (const t of snapshot.transactions) {
    if (!counted(t)) continue;
    for (const label of new Set(bracketLabels(t.remarks))) {
      const k = tagKey(label);
      if (known.has(k)) continue;
      const cur = sums.get(k) ?? { label, count: 0, total: 0 };
      cur.count += 1;
      cur.total = round2(cur.total + t.amount!);
      sums.set(k, cur);
    }
  }
  return [...sums.values()].filter((s) => s.count >= minCount).sort((a, b) => b.count - a.count);
}
