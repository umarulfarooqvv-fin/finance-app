'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { reassignMethod } from '@/lib/transactions';
import { forgetPhotoCorrection, readPhotoCorrections } from '@/lib/photo-check';

/* ===========================================================================
   Acknowledging or undoing a card correction made from an entry's photo.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY.
   =========================================================================== */

type Input = { transactionId: string };
const validate = (input: Input) => (input.transactionId?.trim() ? null : { transactionId: 'Missing entry.' });

/** Put the entry back on the card it was logged against. */
export const undoPhotoCorrectionAction = guardedAction(
  { name: 'photo-correction.undo', revalidate: MONEY_PATHS, validate },
  async (input, ctx) => {
    const found = (await readPhotoCorrections()).find((c) => c.transactionId === input.transactionId);
    if (!found) throw new Error('That correction has already been dealt with.');
    // Moved back first, forgotten second: if the move fails, the notice (and
    // its Undo) is still there to try again.
    await reassignMethod(found.transactionId, found.from, ctx);
    await forgetPhotoCorrection(found.transactionId);
    return { id: found.transactionId, method: found.from };
  },
);

/** Seen, and right. Keep the correction; stop showing the notice. */
export const dismissPhotoCorrectionAction = guardedAction(
  { name: 'photo-correction.dismiss', revalidate: MONEY_PATHS, validate },
  async (input) => {
    await forgetPhotoCorrection(input.transactionId);
    return { id: input.transactionId };
  },
);
