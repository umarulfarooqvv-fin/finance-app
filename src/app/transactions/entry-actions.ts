'use server';

import { requireSession } from '@/lib/auth';
import { getSnapshot } from '@/lib/snapshot';
import { creditLedger } from '@/lib/credit';
import { fail, ok, type ActionResult } from '@/lib/action-result';
import type { EditableTransaction } from './transaction-dialog';
import type { Debtor, EditableIncome } from '@/app/income/income-dialog';

/* ===========================================================================
   Loading one entry into the edit form, from wherever it was seen.

   Every list in the app — a card's statement, the analysis, Today, the tally
   — shows an entry's id and little else. The edit button carries only that
   id, and this fills the form from the cached snapshot, so opening it costs
   no round-trip to the database.

   A server action rather than a route: anything under /api/entry is exempt
   from the PIN (the Shortcut posts there), and a lookup route beside it
   would have been readable by anyone. An action runs under the session.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY.
   =========================================================================== */

export type LoadedEntry =
  | { kind: 'transaction'; entry: EditableTransaction }
  | { kind: 'income'; entry: EditableIncome; debtors: Debtor[] };

export async function loadEntryAction(id: string): Promise<ActionResult<LoadedEntry>> {
  const auth = await requireSession();
  if (!auth.ok) return fail(auth.error);
  if (!id?.trim()) return fail('No entry was named.');

  const snap = await getSnapshot();

  const t = snap.transactions.find((x) => x.id === id);
  if (t) {
    if (t.deleted) return fail('That entry has been deleted. Restore it from Entries → View deleted.');
    if (!t.ts) return fail('That entry has no date, so the form cannot open it. Find it under Entries.');
    return ok({
      kind: 'transaction',
      entry: {
        id: t.id,
        ts: t.ts,
        amount: t.amount ?? 0,
        method: t.method,
        category: t.category,
        remarks: t.remarks,
      },
    });
  }

  const i = snap.income.find((x) => x.id === id);
  if (i) {
    if (i.deleted) return fail('That income entry has been deleted.');
    if (!i.ts) return fail('That income entry has no date, so the form cannot open it.');
    // The form offers who a repayment came from, as the Income page does.
    const debtors = creditLedger(snap).people
      .filter((p) => !p.settled)
      .map((p) => ({ person: p.person, outstanding: p.outstanding }));
    return ok({
      kind: 'income',
      entry: {
        id: i.id,
        ts: i.ts,
        amount: i.amount ?? 0,
        source: i.source,
        account: i.account,
        remarks: i.remarks,
      },
      debtors,
    });
  }

  return fail('That entry could not be found. It may have changed — refresh and try again.');
}
