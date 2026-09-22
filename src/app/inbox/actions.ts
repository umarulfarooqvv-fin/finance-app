'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { detachPhoto, discardCapture, markUsed } from '@/lib/captures';
import { forgetCaptureDrafts } from '@/lib/capture-drafts';

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
    // The photo is gone, so the rows read out of it describe nothing.
    await forgetCaptureDrafts([input.id]);
    return { id: input.id };
  },
);

/** Remove a photo already attached to an entry, from the entry form itself. */
export const detachPhotoAction = guardedAction(
  {
    name: 'capture.detach',
    revalidate: REVALIDATE,
    validate: (input: { id: string }) => (input.id?.trim() ? null : { id: 'Missing photo.' }),
  },
  async (input, ctx) => {
    await detachPhoto(input.id, ctx);
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
    // It is an entry now; the draft it was waiting to become has served.
    await forgetCaptureDrafts([input.id]);
    return { id: input.id };
  },
);

/**
 * Retire the photos a batch of imported rows came from.
 *
 * One photo can produce several rows — a bill with three lines on it — and a
 * capture records the single entry it became, so it is linked to the first of
 * them. That keeps the picture reachable from the ledger (the entry shows a
 * camera) instead of the photo sitting in the inbox forever, re-offering rows
 * that are already filed.
 *
 * Called only after an import that refused nothing. A partial import leaves
 * every photo where it is: re-offering a row is a nuisance, losing the
 * receipt for one that never saved is not.
 */
export const retireCapturesAction = guardedAction(
  {
    name: 'capture.retire',
    revalidate: REVALIDATE,
    validate: (input: { ids: string[]; transactionId: string }) =>
      Array.isArray(input.ids) && input.ids.length > 0 && input.transactionId?.trim()
        ? null
        : { ids: 'Missing photos or entry.' },
  },
  async (input, ctx) => {
    const retired: string[] = [];
    for (const id of input.ids) {
      // One failure must not strand the rest — the entries are already saved.
      try {
        await markUsed(id, input.transactionId, ctx);
        retired.push(id);
      } catch {
        /* Left in the inbox, which is the safe direction. */
      }
    }
    await forgetCaptureDrafts(retired);
    return { retired: retired.length };
  },
);
