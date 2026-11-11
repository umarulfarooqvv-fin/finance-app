import 'server-only';
import { listCaptures, markUsed } from '@/lib/captures';
import { consumeDraftRows, forgetCaptureDrafts, readCaptureDrafts, withoutRow } from '@/lib/capture-drafts';
import { readCapturePlaces } from '@/lib/capture-places';
import { draftEntries, entryInput, needingDetail, type DraftEntry, type Reading } from '@/lib/draft-entries';
import { bankMethodsFrom } from '@/lib/bank-methods';
import { parseImport } from '@/lib/import-parse';
import { createTransaction, idFromKey } from '@/lib/transactions';
import { placeFromPhoto } from '@/lib/places';
import { getSnapshot, invalidateSnapshot } from '@/lib/snapshot';
import { readConfigKey, writeConfigKey } from '@/lib/config';
import { addSeconds, dayOf, nowIST } from '@/lib/time';
import type { Actor } from '@/lib/auth';
import type { Snapshot, Transaction } from '@/lib/types';

/* ===========================================================================
   Rows read off photos, made into entries WITHOUT BEING ASKED.

   The second deliberate exception to "a reading never becomes an entry by
   itself", and like the first (lib/photo-check) asked for by the owner: the
   drafts were piling up unadded, and an expense recorded nowhere is worse
   than one recorded with a gap. lib/draft-entries decides which rows are
   safe — never one that looks like an entry already on file — and this does
   the writing.

   AUTOMATIC, NEVER QUIET. Every entry made here is kept in a list
   (`photo_auto`) shown on Today and Entries until acknowledged, carries the
   source 'photo', and stays listed as needing a detail for as long as its
   payment or category is blank. Keep it that way.

   Runs when a photo has just been read (/api/capture, /api/inbox/convert) and
   from Entries for anything still waiting. `PHOTO_AUTO_ADD=off` turns it off;
   drafts then wait for a tap as they used to.

   SAFE TO RUN TWICE, OR AT ONCE. An entry's id comes from its photo and row,
   so a second pass finds the same entry instead of making another; a row
   whose entry already exists is cut from the reading rather than compared
   with it and called its own duplicate.
   =========================================================================== */

/** `source` on every entry made from a photo's reading. */
export const PHOTO_SOURCE = 'photo';

const LOG = 'photo_auto';
/** A backlog's worth; anything older has been seen or is on Entries anyway. */
const KEEP = 200;

export type AutoAdded = { tx: string; at: string };

export function autoAddOn(): boolean {
  return (process.env.PHOTO_AUTO_ADD ?? '').trim().toLowerCase() !== 'off';
}

/** The idempotency key of the entry a draft row becomes — by hand or not. */
export const draftKey = (captureId: string, raw: string) => `draft:${captureId}:${raw}`;

type RowDone = { captureId: string; raw: string; tx: string };

/**
 * The drafts as they stand, and `stale`: rows whose entry already exists (a
 * pass that was cut short after saving) and only need cutting from the
 * reading. Reads only.
 */
export async function loadDrafts(snap: Snapshot, today: string): Promise<{ drafts: DraftEntry[]; stale: RowDone[] }> {
  const [pending, stored, places] = await Promise.all([
    // A missing captures table (the migration not run) just means no drafts.
    listCaptures('pending').catch(() => []),
    readCaptureDrafts(),
    readCapturePlaces(),
  ]);
  const bankMethods = bankMethodsFrom(snap.config);
  const existing = new Set(snap.transactions.map((t) => t.id));

  const readings: Record<string, Reading> = {};
  const stale: RowDone[] = [];
  for (const c of pending) {
    const r = stored[c.id];
    if (!r?.text) continue;
    let text = r.text;
    for (const row of parseImport(r.text, { bankMethods }).rows) {
      const tx = await idFromKey(draftKey(c.id, row.raw));
      if (!existing.has(tx)) continue;
      stale.push({ captureId: c.id, raw: row.raw, tx });
      text = withoutRow(text, row.raw);
    }
    readings[c.id] = { text, ...(r.hidden ? { hidden: r.hidden } : {}) };
  }

  const drafts = draftEntries(
    pending.map((c) => ({ id: c.id, ts: c.ts, bytes: c.bytes })),
    readings, bankMethods, snap.transactions, places, today,
  );
  return { drafts, stale };
}

/** Cut rows that became entries; a photo with nothing left leaves the inbox,
    linked to the first entry it made. */
export async function retireRows(rows: RowDone[], ctx: Actor): Promise<string[]> {
  const left = await consumeDraftRows(rows);
  const finished = Object.entries(left).filter(([, r]) => parseImport(r.remaining).rows.length === 0);
  for (const [captureId, r] of finished) await markUsed(captureId, r.firstTx, ctx);
  await forgetCaptureDrafts(finished.map(([id]) => id));
  return finished.map(([id]) => id);
}

/**
 * Add every draft the rules allow, oldest first, at most `limit` in this
 * call. Returns how many were added and how many addable ones are left for
 * the next call — so a long backlog can be worked through in short requests.
 */
export async function autoAddDrafts(ctx: Actor, limit = 50): Promise<{ added: number; left: number }> {
  if (!autoAddOn()) return { added: 0, left: 0 };

  const addable = (d: DraftEntry) => d.auto.add;
  const today = dayOf(nowIST());

  // A look at the snapshot in hand first: usually there is nothing to do.
  let loaded = await loadDrafts(await getSnapshot(), today);
  if (!loaded.drafts.some(addable) && loaded.stale.length === 0) return { added: 0, left: 0 };

  /* Then the ledger as it is NOW. The duplicate check is only as good as the
     entries it can see, and the entry most likely to be this photo's twin is
     the one logged from the phone a moment ago — newer than any cache. */
  loaded = await loadDrafts(await getSnapshot({ force: true }), today);
  const todo = loaded.drafts.filter(addable).sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const batch = todo.slice(0, limit);

  const done: RowDone[] = [];
  for (const d of batch) {
    try {
      const { id } = await createTransaction(
        { ...entryInput(d), clientKey: draftKey(d.captureId, d.raw) }, ctx, PHOTO_SOURCE,
      );
      // Spent where the photo was taken.
      await placeFromPhoto(d.captureId, [id], ctx.actor);
      done.push({ captureId: d.captureId, raw: d.raw, tx: id });
    } catch (err) {
      // One row failing costs that row, which simply stays a draft.
      console.error('[photo-auto]', d.captureId, err instanceof Error ? err.message : err);
    }
  }

  if (done.length || loaded.stale.length) await retireRows([...loaded.stale, ...done], ctx);
  if (done.length) await rememberAdded(done.map((r) => r.tx));
  invalidateSnapshot();
  return { added: done.length, left: todo.length - batch.length };
}

export async function readAutoAdded(): Promise<AutoAdded[]> {
  try {
    return (await readConfigKey<AutoAdded[]>(LOG)) ?? [];
  } catch {
    return [];
  }
}

async function rememberAdded(ids: string[]): Promise<void> {
  const at = nowIST();
  const list = (await readAutoAdded()).filter((x) => !ids.includes(x.tx));
  await writeConfigKey(LOG, [...ids.map((tx) => ({ tx, at })), ...list].slice(0, KEEP));
}

/** "OK, seen." Entries still missing a detail stay listed until completed. */
export async function clearAutoAdded(): Promise<void> {
  await writeConfigKey(LOG, []);
}

/**
 * The list a page shows — and, if anything was added under a minute ago, drop
 * this server's cached snapshot first: the add happens after some OTHER
 * request has answered, so this process may not have heard of it (the same
 * reason as photoNoticesForPage).
 */
export async function autoAddedForPage(): Promise<AutoAdded[]> {
  const list = await readAutoAdded();
  const recent = addSeconds(nowIST(), -60);
  if (list.some((x) => x.at > recent)) invalidateSnapshot();
  return list;
}

export type PhotoEntryRow = {
  id: string; ts: string; amount: number; method: string; category: string; remarks: string;
};

const strip = (t: Transaction): PhotoEntryRow => ({
  id: t.id, ts: t.ts!, amount: t.amount ?? 0, method: t.method, category: t.category, remarks: t.remarks,
});

/**
 * What the "from your photos" notice shows: entries still missing a payment
 * or a category (until they are completed), and the rest of what was added
 * since the list was last acknowledged.
 */
export function photoEntries(snap: Snapshot, log: AutoAdded[]): { needs: PhotoEntryRow[]; added: PhotoEntryRow[]; unseen: number } {
  const needs = needingDetail(snap.transactions, PHOTO_SOURCE);
  const needy = new Set(needs.map((t) => t.id));
  const logged = new Set(log.map((x) => x.tx));
  const live = snap.transactions.filter((t) => logged.has(t.id) && !t.deleted && t.ts);
  const added = live.filter((t) => !needy.has(t.id)).sort((a, b) => (a.ts! < b.ts! ? 1 : -1));
  return { needs: needs.map(strip), added: added.map(strip), unseen: live.length };
}
