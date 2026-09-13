import 'server-only';
import { insert, logEvent, select, update } from '@/lib/supabase';
import { deleteObject } from '@/lib/storage';
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
