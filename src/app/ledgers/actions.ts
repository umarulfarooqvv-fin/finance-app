'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { recordManualRepayment, removeManualRepayment } from '@/lib/credit-config';
import { nowIST } from '@/lib/time';
import { parseUserAmount } from '@/lib/money';
import type { FieldErrors } from '@/lib/action-result';

/* ===========================================================================
   Marking money as come back.

   It RECORDS A REPAYMENT rather than deleting the lending. The lending stays
   where it is, the repayment stands beside it, and the two net to nothing —
   whereas erasing the lending would make a real transaction vanish from a
   year's spending and from the card it was charged to.

   The amount is passed explicitly rather than read from the balance here,
   because the balance is what the page was showing when the button was
   pressed. Recomputing it inside the action would let a stale screen settle a
   figure the person never actually saw.
   =========================================================================== */

const REVALIDATE = [...MONEY_PATHS, '/ledgers'];

export const settleCreditAction = guardedAction(
  {
    name: 'credit.settle',
    revalidate: REVALIDATE,
    validate: (input: { person: string; amount: string; note?: string }): FieldErrors | null => {
      if (!input.person?.trim()) return { person: 'Which person?' };
      const parsed = parseUserAmount(input.amount);
      if (!parsed.ok) return { amount: 'That is not an amount.' };
      if (parsed.amount <= 0) return { amount: 'A repayment has to be more than nothing.' };
      return null;
    },
  },
  async (input, ctx) => {
    const parsed = parseUserAmount(input.amount);
    if (!parsed.ok) throw new Error('That is not an amount.');

    const ts = nowIST();
    return recordManualRepayment(
      {
        /* Derived from the person, the figure and the DAY, so a double press
           is one repayment — and settling the same person again tomorrow, for
           a genuinely separate sum, still records separately. */
        id: `manual:${input.person.trim().toLowerCase()}:${parsed.amount}:${ts.slice(0, 10)}`,
        person: input.person.trim(),
        ts,
        amount: parsed.amount,
        note: input.note?.trim() || 'Recorded by hand',
      },
      ctx,
    );
  },
);

export const unsettleCreditAction = guardedAction(
  {
    name: 'credit.settle.undo',
    revalidate: REVALIDATE,
    validate: (input: { id: string }): FieldErrors | null =>
      input.id?.trim() ? null : { id: 'Which repayment?' },
  },
  async (input, ctx) => removeManualRepayment(input.id, ctx),
);
