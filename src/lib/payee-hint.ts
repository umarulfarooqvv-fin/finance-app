import { ALL_METHODS, SPEND_CATEGORIES } from '@/lib/types';
import type { Transaction } from '@/lib/types';

/* ===========================================================================
   "Last time you paid this person, it was Food."

   A photo of a UPI payment to "Usman P P" cannot say what it was for, so the
   reading leaves the category blank (lib/import-prompt: never guess). The
   ledger often can: the same name has been paid before, and filed. This
   finds those earlier entries and offers what they were filed under.

   A SUGGESTION, NEVER A FILL. It is shown beside the blank for one tap to
   accept; nothing is saved until a person takes it. A friend paid for lunch
   one week and lent money the next is the same name with two categories.

   Pure: transactions in, a hint out.
   =========================================================================== */

/** Categories the "needs a detail" list offers — a card is not something
    money is spent ON, and Credit Return is money coming back. */
export const PICKABLE_CATEGORIES: readonly string[] = [
  ...SPEND_CATEGORIES.filter((c) => c !== 'Credit Return'), 'Credit Given',
];

export type Hint = { value: string; count: number; of: number };
export type PayeeHint = { category: Hint | null; method: Hint | null };

/** A name as it is compared: case, punctuation and an "[occasion]" tag ignored. */
export function payeeKey(remarks: string): string {
  return remarks
    .replace(/\[[^\]]*\]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    // A UPI id keeps its dots ("vyapar.1728@hdfc"); in a name a dot only
    // separates initials ("P.P." is "p p").
    .map((w) => (w.includes('@') ? w.replace(/[^a-z0-9@._-]+/g, '') : w.replace(/[^a-z0-9]+/g, ' ')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* The same payee: the same name, or one name the start of the other when the
   shorter has at least two words — "Muhammed Suhail" and "MUHAMMED SUHAIL C H"
   are one person; "Usman" alone could be anyone called Usman. */
function samePayee(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.split(' ').length >= 2 && (long + ' ').startsWith(short + ' ');
}

/* The value used most often; among equals, the one used most recently. */
function mostUsed(rows: Transaction[], pick: (t: Transaction) => string, allowed: readonly string[]): Hint | null {
  const tally = new Map<string, { count: number; last: string }>();
  let of = 0;
  for (const t of rows) {
    const v = pick(t).trim();
    if (!allowed.includes(v)) continue;
    of++;
    const seen = tally.get(v);
    const ts = t.ts ?? '';
    if (seen) { seen.count++; if (ts > seen.last) seen.last = ts; }
    else tally.set(v, { count: 1, last: ts });
  }
  let best: [string, { count: number; last: string }] | null = null;
  for (const e of tally) {
    if (!best || e[1].count > best[1].count || (e[1].count === best[1].count && e[1].last > best[1].last)) best = e;
  }
  return best ? { value: best[0], count: best[1].count, of } : null;
}

/** What earlier entries to the same payee were filed under, for each blank. */
export function payeeHint(entry: Transaction, transactions: Transaction[]): PayeeHint {
  const key = payeeKey(entry.remarks);
  const needCategory = !entry.category.trim();
  const needMethod = !entry.method.trim();
  if (!key || (!needCategory && !needMethod)) return { category: null, method: null };

  const earlier = transactions.filter((t) => t.id !== entry.id && !t.deleted && samePayee(key, payeeKey(t.remarks)));
  return {
    category: needCategory ? mostUsed(earlier, (t) => t.category, PICKABLE_CATEGORIES) : null,
    method: needMethod ? mostUsed(earlier, (t) => t.method, ALL_METHODS) : null,
  };
}
