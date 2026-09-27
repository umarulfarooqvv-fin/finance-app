'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { deleteTransaction, reassignMethod, retimeTransaction } from '@/lib/transactions';
import { markUsed } from '@/lib/captures';
import { logEvent } from '@/lib/supabase';
import {
  applyProposal, forgetPhotoCorrection, forgetPhotoQuestion, readPhotoCorrections, readPhotoQuestions,
} from '@/lib/photo-check';

/* ===========================================================================
   Acting on what an entry's photo said: undoing a correction, acknowledging
   one, or answering "is this a duplicate?".

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY.
   =========================================================================== */

type Input = { transactionId: string };
const validate = (input: Input) => (input.transactionId?.trim() ? null : { transactionId: 'Missing entry.' });

/** Put the entry back on the card and at the time it was logged with. */
export const undoPhotoCorrectionAction = guardedAction(
  { name: 'photo-correction.undo', revalidate: MONEY_PATHS, validate },
  async (input, ctx) => {
    const found = (await readPhotoCorrections()).find((c) => c.transactionId === input.transactionId);
    if (!found) throw new Error('That correction has already been dealt with.');
    // Moved back first, forgotten second: if the move fails, the notice (and
    // its Undo) is still there to try again.
    if (found.method) await reassignMethod(found.transactionId, found.method.from, ctx);
    if (found.time) await retimeTransaction(found.transactionId, found.time.from, ctx);
    await forgetPhotoCorrection(found.transactionId);
    return { id: found.transactionId };
  },
);

/** Seen, and right. Keep the correction; stop showing the notice. */
export const dismissPhotoCorrectionAction = guardedAction(
  { name: 'photo-correction.dismiss', revalidate: MONEY_PATHS, validate },
  async (input, ctx) => {
    await forgetPhotoCorrection(input.transactionId);
    // Changes nothing in the ledger, but "who made this notice go away?" is
    // otherwise unanswerable.
    await logEvent('photo-correction.acknowledged', { id: input.transactionId, by: ctx.actor, via: ctx.via });
    return { id: input.transactionId };
  },
);

type Answer = Input & { answer: 'duplicate' | 'apply' | 'leave' };

/**
 * The person's answer to "is this the same payment as that one?"
 *
 *   duplicate — delete this entry, and move its photo onto the one kept, so
 *               the receipt is not lost with the copy
 *   apply     — not a duplicate: make the change the photo proposed
 *   leave     — neither; stop asking
 */
export const answerPhotoQuestionAction = guardedAction(
  {
    name: 'photo-question.answer',
    revalidate: MONEY_PATHS,
    validate: (input: Answer) =>
      validate(input) ?? (['duplicate', 'apply', 'leave'].includes(input.answer) ? null : { answer: 'Unknown answer.' }),
  },
  async (input, ctx) => {
    const q = (await readPhotoQuestions()).find((x) => x.transactionId === input.transactionId);
    if (!q) throw new Error('That question has already been answered.');

    if (input.answer === 'duplicate') {
      await markUsed(q.captureId, q.duplicate.id, ctx);
      await deleteTransaction(q.transactionId, ctx);
    } else if (input.answer === 'apply') {
      await applyProposal(q.transactionId, q.proposal, ctx);
    }
    await forgetPhotoQuestion(q.transactionId);
    await logEvent('photo-question.answered', {
      id: q.transactionId, answer: input.answer, duplicateOf: q.duplicate.id, by: ctx.actor, via: ctx.via,
    });
    return { id: q.transactionId, answer: input.answer };
  },
);
