'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { currentSnapshot } from '@/lib/views';
import {
  createTransaction, deleteTransaction, restoreTransaction, setVerified, updateTransaction,
} from '@/lib/transactions';
import { validateTransaction, type TransactionInput } from '@/lib/validation';
import { after } from 'next/server';
import type { FieldErrors } from '@/lib/action-result';
import { parsePlace, type Place } from '@/lib/place';
import { nameTransactionPlace, setTransactionPlace } from '@/lib/places';

/* ===========================================================================
   Server actions for transactions.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY. A single
   `export type { … }` survives the compiler transform as a value reference and
   throws at module evaluation, which 500s *every* action in the file rather
   than the one that looks wrong. Input types therefore live in lib/validation
   and lib/transactions, and are imported here rather than re-exported.

   Each action is one call to guardedAction. The wrapper supplies the session
   check, the validation gate, error translation, cache invalidation and path
   revalidation — so what remains here is only what is specific to the write.
   =========================================================================== */

async function today(): Promise<string> {
  const { today: t } = await currentSnapshot();
  return t;
}

export const createTransactionAction = guardedAction(
  {
    name: 'transaction.create',
    revalidate: MONEY_PATHS,
    // Validation cannot be async, and the date bound needs today's date, so
    // the client submits it and the server re-derives the calendar rules from
    // the value rather than trusting a client clock for anything else.
    validate: (input: TransactionInput & { clientKey: string }) =>
      validateTransaction(input, input.ts.slice(0, 10)),
  },
  async (input, ctx) => {
    // Re-validate the date window against the SERVER's date, not the payload.
    const serverToday = await today();
    const errors = validateTransaction(input, serverToday);
    if (errors) throw new Error(Object.values(errors)[0] ?? 'Invalid entry.');
    return createTransaction(input, ctx);
  },
);

export const updateTransactionAction = guardedAction(
  {
    name: 'transaction.update',
    revalidate: MONEY_PATHS,
    validate: (input: TransactionInput & { id: string }) =>
      input.id ? validateTransaction(input, input.ts.slice(0, 10)) : { id: 'Missing entry id.' },
  },
  async (input, ctx) => {
    const serverToday = await today();
    const errors = validateTransaction(input, serverToday);
    if (errors) throw new Error(Object.values(errors)[0] ?? 'Invalid entry.');
    return updateTransaction(input.id, input, ctx);
  },
);

export const deleteTransactionAction = guardedAction(
  { name: 'transaction.delete', revalidate: MONEY_PATHS },
  async (input: { id: string }, ctx) => deleteTransaction(input.id, ctx),
);

export const restoreTransactionAction = guardedAction(
  { name: 'transaction.restore', revalidate: MONEY_PATHS },
  async (input: { id: string }, ctx) => restoreTransaction(input.id, ctx),
);

export const setVerifiedAction = guardedAction(
  { name: 'transaction.verify', revalidate: MONEY_PATHS },
  async (input: { id: string; verified: boolean }, ctx) =>
    setVerified(input.id, input.verified, ctx),
);

/* Where an entry was spent — set after the entry itself saves, like a photo,
   so a place that fails can never cost the entry. Null clears it. The
   coordinates are re-read through the same parser the Shortcut uses, so the
   browser cannot store a pin outside the map. */
export const setPlaceAction = guardedAction(
  {
    name: 'transaction.place',
    revalidate: ['/transactions', '/map'],
    validate: (input: { id: string; place: Place | null }): FieldErrors | null => {
      if (!input.id?.trim()) return { id: 'Missing entry id.' };
      if (input.place && !checked(input.place)) return { place: 'That is not a location on the map.' };
      return null;
    },
  },
  async (input, ctx) => {
    const place = input.place ? checked(input.place) : null;
    await setTransactionPlace(input.id, place, ctx.actor);
    if (place && !place.label) after(() => nameTransactionPlace(input.id));
    return { id: input.id };
  },
);

function checked(p: Place): Place | null {
  const fields: Record<string, unknown> = { lat: p.lat, lon: p.lon, place: p.label };
  return parsePlace((k) => fields[k]);
}
