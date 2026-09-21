import 'server-only';
import { updateConfigKey } from '@/lib/config';
import { logEvent } from '@/lib/supabase';
import type { Actor } from '@/lib/auth';
import type { CreditConfig } from '@/lib/credit';

/* ===========================================================================
   Saying, by hand, who a repayment came from.

   The ledger guesses the debtor by looking for a known name in the row's own
   text. That is right most of the time and silently wrong the rest: a
   repayment remarked "Visiting card aquafenix" names nobody, settles nothing,
   and leaves the lending outstanding for ever.

   This writes the answer down. It is read-modify-write on the single
   `credit_status` key, so recording one mapping cannot erase the aliases or
   the hand-entered repayments stored beside it.

   Three states, and they are genuinely different:

     a name   this repayment is from that person
     ''       this is NOT a repayment, ignore it even though it looks like one
     CLEAR    no decision recorded; let the ledger guess again
   =========================================================================== */

export const CREDIT_KEY = 'credit_status';

/** Sentinel meaning "remove the recorded decision", distinct from ''. */
export const CLEAR = '__clear__';

export async function assignRepayment(
  id: string,
  person: string,
  ctx: Actor,
): Promise<{ id: string; person: string }> {
  if (!id.trim()) throw new Error('Missing entry.');
  const value = person.trim();

  await updateConfigKey<CreditConfig>(CREDIT_KEY, (current) => {
    const map = { ...(current.assignRepayment ?? {}) };
    if (value === CLEAR) delete map[id];
    else map[id] = value;
    return { ...current, assignRepayment: map };
  });

  await logEvent('credit.assign-repayment', {
    id, person: value === CLEAR ? null : value, by: ctx.actor, via: ctx.via,
  });
  return { id, person: value };
}

/* ===========================================================================
   Recording that money came back.

   A repayment is only known to the ledger when it was logged as income or as a
   Credit Return row. Cash handed over in person never was, so the balance sits
   there reading as outstanding — and the Ledgers page has to keep saying "not
   recorded as repaid" about money that came back years ago.

   This writes the missing half. It records a REPAYMENT, never a deletion: the
   lending stays in the ledger, the repayment stands beside it, and the two net
   to nothing. Erasing the lending instead would make a real transaction
   disappear from a year's spending and from the card it was charged to.

   Each one carries its own id so it can be undone, and so recording the same
   settlement twice does not halve a balance that was only owed once.
   =========================================================================== */

export type ManualRepayment = {
  id: string;
  person: string;
  ts: string;
  amount: number;
  note?: string;
};

export async function recordManualRepayment(
  entry: ManualRepayment,
  ctx: Actor,
): Promise<{ id: string }> {
  if (!entry.person.trim()) throw new Error('Which person?');
  if (!(entry.amount > 0)) throw new Error('A repayment has to be more than nothing.');

  await updateConfigKey<CreditConfig>(CREDIT_KEY, (current) => {
    const manual = [...(current.manual ?? [])];
    // Same id twice is a repeat press, not a second repayment.
    if (manual.some((m) => m.id === entry.id)) return current;
    manual.push(entry);
    return { ...current, manual };
  });

  await logEvent('credit.manual-repayment', {
    id: entry.id,
    person: entry.person,
    amount: entry.amount,
    by: ctx.actor,
    via: ctx.via,
  });
  return { id: entry.id };
}

/** Undo one hand-recorded repayment. The lending it settled comes back. */
export async function removeManualRepayment(id: string, ctx: Actor): Promise<{ id: string }> {
  if (!id.trim()) throw new Error('Which repayment?');

  await updateConfigKey<CreditConfig>(CREDIT_KEY, (current) => ({
    ...current,
    manual: (current.manual ?? []).filter((m) => m.id !== id),
  }));

  await logEvent('credit.manual-repayment.remove', { id, by: ctx.actor, via: ctx.via });
  return { id };
}
