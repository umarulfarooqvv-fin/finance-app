'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { currentSnapshot } from '@/lib/views';
import { getCapture } from '@/lib/captures';
import { hideDraftRow, readCaptureDrafts } from '@/lib/capture-drafts';
import { dateFromReading } from '@/lib/capture-entry';
import { parseImport } from '@/lib/import-parse';
import { bankMethodsFrom } from '@/lib/bank-methods';
import { createTransaction, updateTransaction } from '@/lib/transactions';
import { placeFromPhoto } from '@/lib/places';
import { joinTags } from '@/lib/user-tags';
import { entryInput, gapErrors } from '@/lib/draft-entries';
import {
  autoAddDrafts, clearAutoAdded, draftKey, loadDrafts, PHOTO_SOURCE, retireRows,
} from '@/lib/draft-auto';
import { getSnapshot } from '@/lib/snapshot';
import { ALL_CATEGORIES, ALL_METHODS } from '@/lib/types';
import type { Actor } from '@/lib/auth';
import type { FieldErrors } from '@/lib/action-result';

/* ===========================================================================
   Drafts on Entries (rows the AI read off inbox photos) becoming entries.

   Most become entries by themselves — lib/draft-auto, run from here for
   whatever is still waiting when Entries is opened. What is left on the page
   is what the rules held back: a possible duplicate, a date not trusted, no
   amount. Those wait for one of the actions below.

   ADD SAVES WHAT WAS READ, NOT WHAT THE BROWSER SENDS. The row is found again
   in the stored reading and dated by the same rules as the inbox form, so the
   button cannot save something other than the draft the person looked at.
   A blank category or payment is allowed through — the entry is then listed
   as needing that detail — but a row with no amount is opened in the ordinary
   form instead, and that form's save comes back here through draftSavedAction.

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
  const retired = await retireRows([{ ...ref, tx: transactionId }], ctx);
  return retired.includes(ref.captureId);
}

/** Everything that can be added without asking — a few per call, so a long
    backlog is worked through in short requests (a row costs about three
    seconds; see maxDuration on the page). Entries calls it on opening. */
export const autoAddDraftsAction = guardedAction(
  { name: 'draft.auto', revalidate: REVALIDATE },
  async (_input: Record<string, never>, ctx) => autoAddDrafts(ctx, 5),
);

/** "OK" on the list of entries added from photos. */
export const ackAutoAddedAction = guardedAction(
  { name: 'draft.auto.ack', revalidate: ['/', '/transactions'] },
  async (_input: Record<string, never>) => {
    await clearAutoAdded();
    return { ok: true };
  },
);

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

    const entry = entryInput({
      amount: row.amount, method: row.method, category: row.category, remarks: row.remarks, tags: row.tags,
      ts: dateFromReading(row.day, row.time, capture.ts).ts,
    });
    const errors = gapErrors(entry, today);
    if (errors) throw new Error(`${Object.values(errors)[0] ?? 'Incomplete.'} Use Edit to finish it.`);

    // Keyed by the photo and the row: a double tap or a retry finds the same entry.
    const { id } = await createTransaction({ ...entry, clientKey: draftKey(input.captureId, input.raw) }, ctx, PHOTO_SOURCE);
    // Spent where the photo was taken.
    await placeFromPhoto(input.captureId, [id], ctx.actor);
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
  async (input, ctx) => {
    // The form saved its own place if it had one; this fills in only a gap.
    await placeFromPhoto(input.captureId, [input.transactionId], ctx.actor);
    return { retired: await finish(input, input.transactionId, ctx) };
  },
);

/** "Not now": off Entries. The photo stays in the inbox with its reading. */
export const hideDraftAction = guardedAction(
  { name: 'draft.hide', revalidate: REVALIDATE, validate: validRef },
  async (input: RowRef) => {
    await hideDraftRow(input.captureId, input.raw);
    return { hidden: true };
  },
);

/**
 * "It's the same": the draft is a payment already on file. Nothing is added;
 * the row is put away and, when it was the photo's last, the photo is linked
 * to that entry — so the entry gains its receipt and the inbox loses a photo.
 *
 * WHICH entry is decided here, from the ledger as it is now, never taken from
 * the browser.
 */
export const sameEntryAction = guardedAction(
  { name: 'draft.same', revalidate: REVALIDATE, validate: validRef },
  async (input: RowRef, ctx) => {
    const { today } = await currentSnapshot();
    const { drafts } = await loadDrafts(await getSnapshot({ force: true }), today);
    const d = drafts.find((x) => x.captureId === input.captureId && x.raw === input.raw);
    if (!d) throw new Error('This draft has already been dealt with.');
    const twin = d.duplicateOf?.id;
    if (!twin) throw new Error('The entry it matched is no longer there. Add it, or hide it.');
    return { id: twin, retired: await finish(input, twin, ctx) };
  },
);

/**
 * Fill in what an entry made from a photo was missing: the payment, the
 * category, or both. ONLY a blank field is filled — this is the answer to a
 * question, not an edit, so it can never change something already recorded.
 */
export const fillEntryAction = guardedAction(
  {
    name: 'draft.fill',
    revalidate: REVALIDATE,
    validate: (i: { id: string; method?: string; category?: string }): FieldErrors | null => {
      if (!i.id?.trim()) return { id: 'Missing entry.' };
      if (!i.method && !i.category) return { id: 'Nothing to fill in.' };
      if (i.method && !(ALL_METHODS as readonly string[]).includes(i.method)) return { method: 'That is not a known payment method.' };
      if (i.category && !(ALL_CATEGORIES as readonly string[]).includes(i.category)) return { category: 'That is not a known category.' };
      return null;
    },
  },
  async (input, ctx) => {
    const { today } = await currentSnapshot();
    const snap = await getSnapshot({ force: true });
    const t = snap.transactions.find((x) => x.id === input.id);
    if (!t || t.deleted || !t.ts) throw new Error('That entry is no longer there.');

    const next = {
      amount: t.amount,
      ts: t.ts,
      method: t.method.trim() || input.method || '',
      category: t.category.trim() || input.category || '',
      remarks: joinTags(t.remarks, t.userTags),
    };
    const errors = gapErrors(next, today);
    if (errors) throw new Error(Object.values(errors)[0] ?? 'Invalid entry.');
    return updateTransaction(t.id, next, ctx);
  },
);
