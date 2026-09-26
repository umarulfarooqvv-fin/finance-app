import 'server-only';
import { insert, logEvent, select, update } from '@/lib/supabase';
import {
  deleteObject, extensionFor, idFromBytes, isAllowedImage, MAX_IMAGE_BYTES, putObject,
} from '@/lib/storage';
import { toStorable } from '@/lib/image-convert';
import type { Actor } from '@/lib/auth';
import type { Tables, TablesInsert } from '@/types/database';

/* ===========================================================================
   Photos taken now, turned into entries later.

   The gap this fills is visible in the data: entries made days after the fact
   are the ones remarked "Unknown food" with no method, because the detail was
   gone by the time there was a minute to type it. A photo of the shop or the
   bill keeps the detail until there is.

   Rows go through the same typed client as every other table, so a column
   renamed in Postgres becomes a compile error here rather than an undefined at
   runtime. (This module briefly carried a hand-rolled row type, because the
   table did not exist until db/migrations/002_captures.sql was applied. It
   does now, and the generated type replaced it.)
   =========================================================================== */

export type CaptureStatus = 'pending' | 'used' | 'discarded';

export type CaptureRow = Tables<'captures'>;
export type NewCaptureRow = TablesInsert<'captures'>;

/**
 * True when the table exists.
 *
 * Kept after the migration landed, for a fresh clone: the inbox shows what to
 * run rather than an error nobody can act on.
 */
export async function capturesReady(): Promise<boolean> {
  try {
    await select('captures', { select: 'id', limit: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function listCaptures(status: CaptureStatus = 'pending'): Promise<CaptureRow[]> {
  return select('captures', {
    filters: { status: `eq.${status}` },
    order: 'ts.desc',
    limit: 200,
  });
}

export async function getCapture(id: string): Promise<CaptureRow | null> {
  const rows = await select('captures', { filters: { id: `eq.${id}` }, limit: 1 });
  return rows[0] ?? null;
}

/**
 * Which entries have a photo attached, as transaction id -> capture id.
 *
 * For the transaction list, so it can show a small indicator without a
 * per-row request. Empty rather than thrown on a fresh clone that hasn't run
 * the captures migration yet, same as `capturesReady`.
 */
export async function photosByTransaction(): Promise<Map<string, string>> {
  try {
    const rows = await select('captures', {
      filters: { status: 'eq.used' },
      select: 'id,transaction_id',
    });
    const out = new Map<string, string>();
    for (const r of rows) if (r.transaction_id) out.set(r.transaction_id, r.id);
    return out;
  } catch {
    return new Map();
  }
}

export async function insertCapture(row: NewCaptureRow): Promise<void> {
  // Upsert: the id is a hash of the image, so a retried post is the same photo
  // and must land on the same row rather than failing as a duplicate.
  await insert('captures', [row], { upsert: true });
}

/** Mark a capture as having become an entry, and say which one. */
export async function markUsed(id: string, transactionId: string, ctx: Actor): Promise<void> {
  await update('captures', { id: `eq.${id}` }, {
    status: 'used',
    transaction_id: transactionId,
    updated_by: ctx.actor,
  });
  await logEvent('capture.used', { id, transactionId, by: ctx.actor, via: ctx.via });
}

/**
 * Discard a capture and remove its image.
 *
 * The row is marked FIRST and the object deleted second. An orphaned row
 * pointing at nothing is visible and recoverable; an image with no row is
 * invisible and sits in the bucket for ever.
 */
export async function discardCapture(id: string, ctx: Actor): Promise<void> {
  const row = await getCapture(id);
  if (!row) throw new Error('That capture no longer exists.');
  if (row.status === 'used') throw new Error('That capture is already an entry.');

  await update('captures', { id: `eq.${id}` }, { status: 'discarded', updated_by: ctx.actor });
  await logEvent('capture.discard', { id, by: ctx.actor, via: ctx.via });
  await deleteObject(row.path);
}

/**
 * Remove a photo that is already attached to an entry — from the entry form
 * itself, not the inbox.
 *
 * `discardCapture` above REFUSES a used capture on purpose: in the inbox, a
 * used one already became a transaction, and discarding it would erase the
 * evidence for a row that still exists. Here the situation is the opposite —
 * the entry is staying, the person is only taking the photo off it — so the
 * transaction link is cleared along with the image rather than protected.
 */
export async function detachPhoto(id: string, ctx: Actor): Promise<void> {
  const row = await getCapture(id);
  if (!row) return; // Already gone is the goal state, not an error.
  if (row.status === 'discarded') return;

  await update('captures', { id: `eq.${id}` }, {
    status: 'discarded',
    transaction_id: null,
    updated_by: ctx.actor,
  });
  await logEvent('capture.detach', { id, by: ctx.actor, via: ctx.via });
  await deleteObject(row.path);
}

/**
 * Attach a photo directly to a transaction that already exists, skipping the
 * inbox entirely — for the person filling the form right now, or the phone
 * that just posted the entry a moment ago and has the photo in hand.
 *
 * THE SAME PATH the inbox uses underneath: an image in the private bucket,
 * a row in `captures`, `status: 'used'` from the first write rather than
 * passing through `pending`. A receipt attached this way never appears in
 * the inbox, because it was never waiting for anything.
 *
 * The id is content-derived, same as every capture, so retrying an upload —
 * a flaky connection, a doubled tap — resolves to the same row. That also
 * means the SAME PHOTO cannot quietly change hands: if its id already
 * belongs to a different transaction, this refuses rather than moving it.
 */
export async function attachPhoto(input: {
  bytes: ArrayBuffer;
  mime: string;
  ts: string;
  note: string;
  transactionId: string;
  source: 'app' | 'shortcut';
  actor: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const mime = input.mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!isAllowedImage(mime)) return { ok: false, error: `${mime} is not an image this app accepts.` };
  if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, error: `That image is ${Math.round(input.bytes.byteLength / 1024 / 1024)}MB; the limit is 20MB.` };
  }

  const rows = await select('transactions', { filters: { id: `eq.${input.transactionId}` }, select: 'id', limit: 1 });
  if (rows.length === 0) return { ok: false, error: 'That entry could not be found.' };

  const id = await idFromBytes(input.bytes);
  // Stored as JPEG where it came as HEIC; see lib/image-convert.
  const stored = await toStorable(input.bytes, mime);

  // A capture already at this id and already used FOR A DIFFERENT ENTRY is
  // not this attach retrying — it is the same bytes claimed twice, and
  // upserting would silently move the photo off the entry it was on.
  const existing = await getCapture(id);
  if (existing?.status === 'used' && existing.transaction_id && existing.transaction_id !== input.transactionId) {
    return { ok: false, error: 'That photo is already attached to a different entry.' };
  }

  const path = existing?.path ?? `${input.ts.slice(0, 7)}/${id}.${extensionFor(stored.mime)}`;
  if (!existing) {
    await putObject(path, stored.bytes, stored.mime);
  }

  try {
    await insertCapture({
      id, ts: input.ts, path,
      mime: existing?.mime ?? stored.mime,
      bytes: existing?.bytes ?? stored.bytes.byteLength,
      note: input.note.trim().slice(0, 500),
      status: 'used',
      transaction_id: input.transactionId,
      source: input.source,
    });
  } catch (err) {
    if (!existing) await deleteObject(path);
    throw err;
  }

  await logEvent('capture.attach', { id, transactionId: input.transactionId, by: input.actor });
  return { ok: true, id };
}
