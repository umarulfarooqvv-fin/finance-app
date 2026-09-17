'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import type { FieldErrors } from '@/lib/action-result';
import { reassignMethod } from '@/lib/transactions';
import { ALL_METHODS } from '@/lib/types';

/* ===========================================================================
   Server actions for the reconciler.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY. A surviving
   `export type` throws at module evaluation and 500s every action in the file.
   =========================================================================== */

export const reassignMethodAction = guardedAction(
  {
    name: 'transaction.reassign-method',
    revalidate: [...MONEY_PATHS, '/reconcile'],
    validate: (input: { id: string; method: string }): FieldErrors | null => {
      if (!input.id?.trim()) return { id: 'Missing entry.' };
      // Only a method the app knows: a typo here moves the debt to a card that
      // does not exist, which is worse than leaving it on the wrong one.
      if (!(ALL_METHODS as readonly string[]).includes(input.method?.trim())) {
        return { method: 'That is not a payment method this app knows.' };
      }
      return null;
    },
  },
  async (input, ctx) => reassignMethod(input.id, input.method.trim(), ctx),
);
