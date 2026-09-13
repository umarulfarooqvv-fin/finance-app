import 'server-only';
import { logEvent } from '@/lib/supabase';
import { deleteObject } from '@/lib/storage';
import type { Actor } from '@/lib/auth';
import type { Instant } from '@/lib/time';

/* ===========================================================================
   Photos taken now, turned into entries later.

   The gap this fills is visible in the data: entries made days after the fact
   are the ones remarked "Unknown food" with no method, because the detail was
   gone by the time there was a minute to type it. A photo of the shop or the
   bill keeps the detail until there is.

   ---------------------------------------------------------------------------
   INTERIM ROW TYPE. Every other table is read through the generated schema in
   src/types/database.ts, and hand-rolled row types are banned there for good
   reason — four latent bugs surfaced the day the client became typed. This
   module cannot do that yet because `captures` does not exist in the database
   until db/migrations/002_captures.sql is applied. After applying it, run
   `npm run gen:types` and this type should be replaced by Tables<'captures'>.
   It is written to match the migration column for column.
   --------------------------------------------------------------------------- */

export type CaptureStatus = 'pending' | 'used' | 'discarded';

export type CaptureRow = {
  id: string;
  ts: Instant;
  path: string;
  mime: string;
  bytes: number;
  note: string | null;
  status: CaptureStatus;
  transaction_id: string | null;
  source: string | null;
  created_at: string | null;
};

const baseUrl = () => (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const serviceKey = () => process.env.SUPABASE_SERVICE_KEY ?? '';

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: serviceKey(),
    Authorization: `Bearer ${serviceKey()}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!baseUrl() || !serviceKey()) throw new Error('Supabase is not configured.');
  const res = await fetch(`${baseUrl()}/rest/v1/${path}`, {
    cache: 'no-store',
    ...init,
    headers: { ...headers(), ...((init.headers as Record<string, string>) ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    // The table is the one thing that cannot be created from here, so say so
    // plainly rather than surfacing a PostgREST 404 nobody can act on.
    if (res.status === 404 && /captures/i.test(text)) {
      throw new Error('The captures table does not exist yet — run db/migrations/002_captures.sql.');
    }
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** True when the table exists; the inbox shows setup instructions when it does not. */
export async function capturesReady(): Promise<boolean> {
  try {
    await rest<CaptureRow[]>('captures?select=id&limit=1');
    return true;
  } catch {
    return false;
  }
}

export async function listCaptures(status: CaptureStatus = 'pending'): Promise<CaptureRow[]> {
  return rest<CaptureRow[]>(
    `captures?select=*&status=eq.${status}&order=ts.desc&limit=200`,
  );
}

export async function getCapture(id: string): Promise<CaptureRow | null> {
  const rows = await rest<CaptureRow[]>(
    `captures?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function insertCapture(row: Omit<CaptureRow, 'created_at'>): Promise<void> {
  await rest('captures', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([row]),
  });
}

async function patch(id: string, body: Record<string, unknown>): Promise<void> {
  await rest(`captures?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
}

/** Mark a capture as having become an entry, and say which one. */
export async function markUsed(id: string, transactionId: string, ctx: Actor): Promise<void> {
  await patch(id, { status: 'used', transaction_id: transactionId, updated_by: ctx.actor });
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

  await patch(id, { status: 'discarded', updated_by: ctx.actor });
  await logEvent('capture.discard', { id, by: ctx.actor, via: ctx.via });
  await deleteObject(row.path);
}
