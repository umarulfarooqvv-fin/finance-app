'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { discardCapture, markUsed } from '@/lib/captures';

/* ===========================================================================
   Server actions for the capture inbox.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY. A surviving
   `export type` throws at module evaluation and 500s every action in the file.
   =========================================================================== */

const REVALIDATE = [...MONEY_PATHS, '/inbox'];

export const discardCaptureAction = guardedAction(
  {
    name: 'capture.discard',
    revalidate: REVALIDATE,
    validate: (input: { id: string }) => (input.id?.trim() ? null : { id: 'Missing capture.' }),
  },
  async (input, ctx) => {
    await discardCapture(input.id, ctx);
    return { id: input.id };
  },
);

/** Link a capture to the entry it became, once that entry has been saved. */
export const linkCaptureAction = guardedAction(
  {
    name: 'capture.link',
    revalidate: REVALIDATE,
    validate: (input: { id: string; transactionId: string }) =>
      input.id?.trim() && input.transactionId?.trim() ? null : { id: 'Missing capture or entry.' },
  },
  async (input, ctx) => {
    await markUsed(input.id, input.transactionId, ctx);
    return { id: input.id };
  },
);
