import 'server-only';
import { select, logEvent } from '@/lib/supabase';
import { getCapture } from '@/lib/captures';
import { getObject } from '@/lib/storage';
import { readReceipts, visionConfigured } from '@/lib/ai/vision';
import { isLimited } from '@/lib/ai/usage';
import { readAiUsage, recordAiUsage } from '@/lib/ai/usage-store';
import { heicToJpeg, isHeic } from '@/lib/image-convert';
import { readConfigKey, writeConfigKey } from '@/lib/config';
import { bankMethodsFrom } from '@/lib/bank-methods';
import { reassignMethod } from '@/lib/transactions';
import { invalidateSnapshot } from '@/lib/snapshot';
import { methodFromPhoto, type MethodVerdict } from '@/lib/photo-method';
import { addSeconds, nowIST } from '@/lib/time';
import type { Actor } from '@/lib/auth';

/* ===========================================================================
   Checking an entry against the photo attached to it, and correcting which
   card it was paid from. The rules are in photo-method.ts; this reads the
   photo, applies them, and records what it did.

   Runs after the photo is attached — from the Shortcut or the entry form —
   scheduled with `after()` so neither waits on a model.

   EVERY CHANGE IS KEPT IN A LIST the app shows until it is acknowledged,
   with an undo. An entry moved between cards without a person seeing it is
   exactly the silent error this app exists to prevent; making the change
   automatic is only acceptable because it is never also quiet.
   =========================================================================== */

const KEY = 'photo_corrections';
/** Enough to cover a busy week; older ones have long since been seen. */
const KEEP = 20;

export type PhotoCorrection = {
  transactionId: string;
  captureId: string;
  from: string;
  to: string;
  /** What the photo printed — "Federal CC XX16". */
  label: string;
  amount: number;
  remarks: string;
  /** The entry's own timestamp, for showing which one. */
  ts: string;
  /** When the correction was made. */
  at: string;
};

export async function readPhotoCorrections(): Promise<PhotoCorrection[]> {
  try {
    return (await readConfigKey<PhotoCorrection[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

/**
 * The corrections to show — and, if one is under a minute old, drop this
 * server's cached snapshot first.
 *
 * A correction happens in the background, after some OTHER request has
 * answered, so this process's snapshot has not heard of it; its own freshness
 * check is throttled to 30s. Without this, the notice would say "moved to
 * Scapia" above a row still reading Fi, for up to half a minute.
 */
export async function correctionsForPage(): Promise<PhotoCorrection[]> {
  const list = await readPhotoCorrections();
  const recent = addSeconds(nowIST(), -60);
  if (list.some((c) => c.at > recent)) invalidateSnapshot();
  return list;
}

/** Take one off the list — acknowledged or undone — and return it. */
export async function forgetPhotoCorrection(transactionId: string): Promise<PhotoCorrection | null> {
  const list = await readPhotoCorrections();
  const found = list.find((c) => c.transactionId === transactionId) ?? null;
  await writeConfigKey(KEY, list.filter((c) => c.transactionId !== transactionId));
  return found;
}

async function remember(c: PhotoCorrection): Promise<void> {
  const list = await readPhotoCorrections();
  await writeConfigKey(KEY, [c, ...list.filter((x) => x.transactionId !== c.transactionId)].slice(0, KEEP));
}

export type CheckOutcome = MethodVerdict | { kind: 'skipped'; reason: string };

/**
 * Read the photo on an entry and, if it proves the entry was paid from a
 * different card, move it there. Never throws: this runs after a response has
 * gone, and a failure costs only the check.
 */
export async function checkEntryAgainstPhoto(
  captureId: string,
  transactionId: string,
  via: Actor['via'],
): Promise<CheckOutcome> {
  const skip = (reason: string): CheckOutcome => ({ kind: 'skipped', reason });
  try {
    if (!visionConfigured()) return skip('photo reading is not set up');
    const now = nowIST();
    if (isLimited(await readAiUsage(), now)) return skip('the AI limit is reached');

    const [tx] = await select('transactions', {
      filters: { id: `eq.${transactionId}` },
      select: 'id,ts,amount,method,remarks,verified,deleted',
      limit: 1,
    });
    if (!tx || tx.deleted) return skip('no such entry');

    const capture = await getCapture(captureId);
    if (!capture) return skip('no such photo');
    const object = await getObject(capture.path);
    if (!object) return skip('the photo could not be read from storage');

    let image = { bytes: object.body, mime: capture.mime };
    if (isHeic(capture.mime)) image = { bytes: await heicToJpeg(object.body), mime: 'image/jpeg' };

    const result = await readReceipts([image], String(tx.ts).slice(0, 10));
    await recordAiUsage(result.usage);
    if (!result.ok) return skip(result.error);

    const bankMethods = bankMethodsFrom({ bank_methods: await readConfigKey('bank_methods').catch(() => null) });
    const verdict = methodFromPhoto(
      result.text,
      { ts: String(tx.ts), amount: Number(tx.amount), method: tx.method ?? '', verified: Boolean(tx.verified) },
      bankMethods,
    );
    // The reading goes in the log with the verdict: a "keep" with no record of
    // what the model saw cannot be explained afterwards.
    await logEvent('photo.check', { transactionId, captureId, verdict, reading: result.text.slice(0, 300) });
    if (verdict.kind !== 'correct') return verdict;

    const moved = await reassignMethod(transactionId, verdict.to, { actor: 'photo-check', via });
    invalidateSnapshot();
    await remember({
      transactionId,
      captureId,
      from: moved.from,
      to: moved.to,
      label: verdict.label,
      amount: Number(tx.amount),
      remarks: tx.remarks ?? '',
      ts: String(tx.ts),
      at: nowIST(),
    });
    return verdict;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[photo-check]', transactionId, message);
    return skip(message);
  }
}
