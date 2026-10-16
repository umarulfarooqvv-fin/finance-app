'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { currentSnapshot } from '@/lib/views';
import { getCapture, markUsed } from '@/lib/captures';
import { consumeDraftRow, forgetCaptureDrafts, hideDraftRow, readCaptureDrafts } from '@/lib/capture-drafts';
import { dateFromReading } from '@/lib/capture-entry';
import { parseImport } from '@/lib/import-parse';
import { bankMethodsFrom } from '@/lib/bank-methods';
import { createTransaction } from '@/lib/transactions';
import { joinTags } from '@/lib/user-tags';
import { validateTransaction } from '@/lib/validation';
import type { Actor } from '@/lib/auth';

/* ===========================================================================
   Turning a draft on Entries (a row the AI read off an inbox photo) into an
   entry — or putting it out of sight.

   ADD SAVES WHAT WAS READ, NOT WHAT THE BROWSER SENDS. The row is found again
   in the stored reading and dated by the same rules as the inbox form, so the
   button cannot save something other than the draft the person looked at.
   A draft with a gap (no category, no card) cannot be added as it is; it is
   opened in the ordinary form instead, and that form's save comes back here
   through draftSavedAction.

   Each row added is cut from the photo's reading at once, so neither the
   inbox nor Entries can offer it twice. When nothing is left, the photo is
   linked to the first entry it became and leaves the inbox.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY.
   =========================================================================== */

const REVALIDATE = [...MONEY_PATHS, '/inbox'];

type RowRef = { captureId: string; raw: string };
const validRef = (i: RowRef) => (i.captureId?.trim() && i.raw?.trim() ? null : { raw: 'Missing draft.' });

/** Cut the row from the reading; retire the photo once nothing is left. */
async function finish(ref: RowRef, transactionId: string, ctx: Actor): Promise<boolean> {
  const r = await consumeDraftRow(ref.captureId, ref.raw, transactionId);
  if (!r) return false;
  if (parseImport(r.remaining).rows.length > 0) return false;
  await markUsed(ref.captureId, r.firstTx, ctx);
  await forgetCaptureDrafts([ref.captureId]);
  return true;
}

export const addDraftEntryAction = guardedAction(
  { name: 'draft.add', revalidate: REVALIDATE, validate: validRef },
  async (input: RowRef, ctx) => {
    const [drafts, capture, { snap, today }] = await Promise.all([
      readCaptureDrafts(), getCapture(input.captureId), currentSnapshot(),
    ]);
    const text = drafts[input.captureId]?.text;
    if (!capture || !text) throw new Error('This draft has already been dealt with.');
    const row = parseImport(text, { bankMethods: bankMethodsFrom(snap.config) }).rows
      .find((x) => x.raw === input.raw);
    if (!row) throw new Error('This draft has already been dealt with.');

    const entry = {
      amount: row.amount,
      method: row.method,
      category: row.category,
      remarks: joinTags(row.remarks, row.tags),
      ts: dateFromReading(row.day, row.time, capture.ts).ts,
    };
    const errors = validateTransaction(entry, today);
    if (errors) throw new Error(`${Object.values(errors)[0] ?? 'Incomplete.'} Use Edit to finish it.`);

    // Keyed by the photo and the row: a double tap or a retry finds the same entry.
    const { id } = await createTransaction({ ...entry, clientKey: `draft:${input.captureId}:${input.raw}` }, ctx);
    const retired = await finish(input, id, ctx);
    return { id, retired };
  },
);

/** The ordinary form saved a draft that needed finishing. */
export const draftSavedAction = guardedAction(
  {
    name: 'draft.saved',
    revalidate: REVALIDATE,
    validate: (i: RowRef & { transactionId: string }) => validRef(i) ?? (i.transactionId?.trim() ? null : { raw: 'Missing entry.' }),
  },
  async (input, ctx) => ({ retired: await finish(input, input.transactionId, ctx) }),
);

/** "Not now": off Entries. The photo stays in the inbox with its reading. */
export const hideDraftAction = guardedAction(
  { name: 'draft.hide', revalidate: REVALIDATE, validate: validRef },
  async (input: RowRef) => {
    await hideDraftRow(input.captureId, input.raw);
    return { hidden: true };
  },
);
