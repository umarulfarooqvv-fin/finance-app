import { foldForSearch } from '@/lib/search-text';
import { endOfDay, startOfDay, type Day } from '@/lib/time';
import type { Snapshot, Transaction } from '@/lib/types';

/* ===========================================================================
   Is this pasted row already in the ledger?

   Importing a month of statement rows means importing over entries that were
   typed at the time. Without this, a careful person re-enters the same forty
   expenses and every total silently doubles — and a doubled total is the kind
   of error that is believed, because nothing about it looks broken.

   IT IS A MULTISET, NOT A SET, for the reason the sheet sync already
   documents: two identical amounts on one day are legitimate and the live
   data contains such pairs. So N pasted copies match N recorded copies, and
   the N+1th is genuinely new.

   TWO TIERS, because certainty differs:

     exact   day, amount, method, category and wording all agree. This is the
             same expense; skipping it is safe and it is skipped by default.

     likely  the day and the amount agree, but the wording or the filing does
             not. A statement says "SWIGGY BANGALORE" where you typed
             "Dinner", and that IS the same expense — but so is a genuine
             second ₹250 on a busy day. It is flagged and LEFT SELECTED,
             because the app cannot tell those apart and quietly dropping a
             real expense is the worse mistake.

   It only ever labels. Nothing here excludes a row on its own.
   =========================================================================== */

export type MatchLevel = 'exact' | 'likely' | 'new';

export type RowMatch = {
  level: MatchLevel;
  /** The entry it matched, for showing what is already there. */
  existing: Transaction | null;
};

/** Enough of a pasted row to match on. */
export type MatchableRow = {
  line: number;
  day: Day;
  amount: number;
  method: string;
  category: string;
  remarks: string;
};

/** Unit separator: cannot occur in the data, so it cannot forge a key. */
const SEP = String.fromCharCode(31);

const paise = (n: number) => Math.round(n * 100);

const exactKey = (day: string, amount: number, method: string, category: string, remarks: string) =>
  [day, paise(amount), foldForSearch(method), foldForSearch(category), foldForSearch(remarks)].join(SEP);

/* The loose key deliberately drops the wording AND the filing: a statement
   describes an expense differently from the person who lived it, and the
   category is often the thing being corrected by the import. */
const looseKey = (day: string, amount: number) => [day, paise(amount)].join(SEP);

/**
 * Label each pasted row against what the ledger already holds.
 *
 * `rows` is consumed in order, so when two pasted rows could both claim one
 * recorded entry the first takes it and the second is reported as new — which
 * is what makes a legitimate pair of identical expenses importable.
 */
export function matchAgainstLedger(
  rows: MatchableRow[],
  snapshot: Snapshot,
): Map<number, RowMatch> {
  const out = new Map<number, RowMatch>();
  if (rows.length === 0) return out;

  /* Only the window the paste covers is worth scanning. A year of entries is
     thousands of rows, and a row dated in March cannot be a duplicate of one
     pasted for September. */
  const days = rows.map((r) => r.day).sort();
  const lo = startOfDay(days[0]!);
  const hi = endOfDay(days[days.length - 1]!);

  const candidates = snapshot.transactions.filter(
    (t) => !t.deleted && t.ts && t.amount != null && t.ts >= lo && t.ts <= hi,
  );

  const byExact = new Map<string, Transaction[]>();
  const byLoose = new Map<string, Transaction[]>();
  for (const t of candidates) {
    const day = t.ts!.slice(0, 10);
    const e = exactKey(day, t.amount!, t.method, t.category, t.remarks ?? '');
    const l = looseKey(day, t.amount!);
    byExact.set(e, [...(byExact.get(e) ?? []), t]);
    byLoose.set(l, [...(byLoose.get(l) ?? []), t]);
  }

  /* Claimed entries are removed from BOTH pools, so one recorded row cannot
     be counted as the duplicate of two different pasted rows. */
  const claimed = new Set<string>();
  const take = (pool: Map<string, Transaction[]>, key: string): Transaction | null => {
    const bucket = pool.get(key);
    if (!bucket) return null;
    while (bucket.length > 0) {
      const t = bucket.shift()!;
      if (!claimed.has(t.id)) {
        claimed.add(t.id);
        return t;
      }
    }
    return null;
  };

  for (const r of rows) {
    const hit = take(byExact, exactKey(r.day, r.amount, r.method, r.category, r.remarks));
    if (hit) {
      out.set(r.line, { level: 'exact', existing: hit });
      continue;
    }
    const near = take(byLoose, looseKey(r.day, r.amount));
    out.set(
      r.line,
      near ? { level: 'likely', existing: near } : { level: 'new', existing: null },
    );
  }

  return out;
}
