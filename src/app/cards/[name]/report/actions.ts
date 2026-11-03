'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { currentSnapshot } from '@/lib/views';
import { createIncome } from '@/lib/income';
import { assignRepayment } from '@/lib/credit-config';
import { validateIncome } from '@/lib/validation';
import { INCOME_ACCOUNTS } from '@/lib/types';

/* ===========================================================================
   "They paid me back, and I never wrote it down."

   A return is recorded the way the app already records money coming back:
   INCOME, source "Credit Return", in the account it arrived in — and LINKED to
   the person, so the credit ledger settles their oldest lendings with it. The
   link matters as much as the entry: an income row that names nobody leaves
   the lending reading as unpaid for ever, which is the very thing this is for.

   The account is the owner's to state, because it decides whose balance goes
   up. "None" is for a return that never reached an account.

   Recording twice must not halve a debt owed once: the id comes from a key
   minted when the form opened, so a double tap or a retry is the same entry.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY.
   =========================================================================== */

type ReturnInput = {
  person: string;
  amount: string | number;
  /** When the money came back. IST wall clock. */
  ts: string;
  account: string;
  note?: string;
  clientKey: string;
};

const asIncome = (i: ReturnInput) => ({
  amount: i.amount,
  source: 'Credit Return',
  account: i.account,
  remarks: i.note?.trim() || `Returned by ${i.person.trim()}`,
  ts: i.ts,
});

export const recordReturnAction = guardedAction(
  {
    name: 'credit.record-return',
    revalidate: [...MONEY_PATHS, '/income', '/ledgers'],
    validate: (input: ReturnInput) => {
      if (!input.person?.trim()) return { person: 'Who paid you back?' };
      if (!(INCOME_ACCOUNTS as readonly string[]).includes(input.account)) {
        return { account: 'Choose where it was received.' };
      }
      return validateIncome(asIncome(input), (input.ts ?? '').slice(0, 10));
    },
  },
  async (input, ctx) => {
    // The date window is checked against the SERVER's clock, never the payload's.
    const { today } = await currentSnapshot();
    const errors = validateIncome(asIncome(input), today);
    if (errors) throw new Error(Object.values(errors)[0] ?? 'Invalid entry.');

    const saved = await createIncome({ ...asIncome(input), clientKey: input.clientKey }, ctx);
    // Name the payer, so the ledger does not have to guess from the words.
    await assignRepayment(saved.id, input.person, ctx);
    return saved;
  },
);
