import { foldForSearch } from '@/lib/search-text';

/* ===========================================================================
   Is a received payment in a paste already in the income list?

   The same rule as spending (lib/import-match), for money coming in:

     exact   same day, same amount, same sender — the same payment; unticked
     likely  same day and amount, someone else's name — shown, left ticked,
             because two ₹100 payments from two friends on one day are two
             payments and dropping a real one is the worse mistake

   AND EACH RECORDED ENTRY ANSWERS FOR ONE ROW ONLY. Without that, one ₹100
   already on file "matched" every ₹100 in the paste that day — four rows
   taken for one, and the three real ones left out.

   Pure: rows in, one answer per row out, in the same order.
   =========================================================================== */

export type ReceivedRow = { day: string; amount: number; account: string; remarks: string };
export type RecordedIncome = { day: string; amount: number; account: string; source: string; remarks: string };
export type IncomeMatch = { level: 'exact' | 'likely'; existing: RecordedIncome } | null;

const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
const words = (s: string) => foldForSearch(s).replace(/\s+/g, ' ').trim();

export function matchIncome(rows: ReceivedRow[], recorded: RecordedIncome[]): IncomeMatch[] {
  const used = new Set<number>();
  const take = (pred: (x: RecordedIncome) => boolean): RecordedIncome | null => {
    const i = recorded.findIndex((x, n) => !used.has(n) && pred(x));
    if (i < 0) return null;
    used.add(i);
    return recorded[i]!;
  };

  // Exact matches first, across the whole paste, so a "likely" guess for one
  // row can never take the entry that is exactly another row.
  const out: IncomeMatch[] = rows.map((r) => {
    const hit = take((x) => x.day === r.day && same(x.amount, r.amount) && x.account === r.account && words(x.remarks) === words(r.remarks));
    return hit ? { level: 'exact', existing: hit } : null;
  });
  return out.map((m, i) => {
    if (m) return m;
    const r = rows[i]!;
    const hit = take((x) => x.day === r.day && same(x.amount, r.amount));
    return hit ? { level: 'likely', existing: hit } : null;
  });
}
