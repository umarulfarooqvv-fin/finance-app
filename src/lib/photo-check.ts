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
import { reassignMethod, retimeTransaction } from '@/lib/transactions';
import { invalidateSnapshot } from '@/lib/snapshot';
import {
  photoVerdict, type OtherEntry, type PhotoProposal, type PhotoVerdict,
} from '@/lib/photo-method';
import { addSeconds, nowIST } from '@/lib/time';
import type { Actor } from '@/lib/auth';

/* ===========================================================================
   Checking an entry against the photo attached to it. The rules are in
   photo-method.ts; this reads the photo, applies them, and records what it
   did — or what it needs a person to decide.

   Runs after the photo is attached — from the Shortcut or the entry form —
   scheduled with `after()` so neither waits on a model.

   TWO LISTS, both shown on Today and Entries until dealt with:
     - corrections: the card or time was changed; each has an Undo.
     - questions: the photo points at a moment when ANOTHER entry looks like
       the same payment. Nothing is changed; the person says whether it is a
       duplicate. Changing a possible duplicate's time would line the two up
       exactly and make them look even more like one payment counted once.

   An entry changed without a person seeing it is exactly the silent error
   this app exists to prevent; automatic is only acceptable because it is
   never also quiet.
   =========================================================================== */

const CORRECTIONS = 'photo_corrections';
const QUESTIONS = 'photo_questions';
/** Enough to cover a busy week; older ones have long since been seen. */
const KEEP = 20;

type EntrySummary = { amount: number; remarks: string; ts: string };

export type PhotoCorrection = EntrySummary & {
  transactionId: string;
  captureId: string;
  method?: { from: string; to: string; label: string };
  time?: { from: string; to: string };
  /** When the correction was made. */
  at: string;
};

export type PhotoQuestion = EntrySummary & {
  transactionId: string;
  captureId: string;
  method: string;
  category: string;
  /** What the photo would change, if this is not a duplicate. */
  proposal: PhotoProposal;
  duplicate: OtherEntry;
  why: string;
  at: string;
};

/** Older corrections stored `from`/`to`/`label` flat, for the card only. */
type LegacyCorrection = PhotoCorrection & { from?: string; to?: string; label?: string };

async function readList<T>(key: string): Promise<T[]> {
  try {
    return (await readConfigKey<T[]>(key)) ?? [];
  } catch {
    return [];
  }
}

export async function readPhotoCorrections(): Promise<PhotoCorrection[]> {
  return (await readList<LegacyCorrection>(CORRECTIONS)).map((c) =>
    c.method || !c.to ? c : { ...c, method: { from: c.from ?? '', to: c.to, label: c.label ?? '' } },
  );
}

export async function readPhotoQuestions(): Promise<PhotoQuestion[]> {
  return readList<PhotoQuestion>(QUESTIONS);
}

/**
 * What the page shows — and, if anything is under a minute old, drop this
 * server's cached snapshot first. A correction happens in the background,
 * after some OTHER request has answered, so this process's snapshot has not
 * heard of it; its own freshness check is throttled to 30s. Without this the
 * notice would say "moved to Scapia" above a row still reading Fi.
 */
export async function photoNoticesForPage(): Promise<{
  corrections: PhotoCorrection[];
  questions: PhotoQuestion[];
}> {
  const [corrections, questions] = await Promise.all([readPhotoCorrections(), readPhotoQuestions()]);
  const recent = addSeconds(nowIST(), -60);
  if (corrections.some((c) => c.at > recent)) invalidateSnapshot();
  return { corrections, questions };
}

export async function forgetPhotoCorrection(transactionId: string): Promise<void> {
  const list = await readList<PhotoCorrection>(CORRECTIONS);
  await writeConfigKey(CORRECTIONS, list.filter((c) => c.transactionId !== transactionId));
}

export async function forgetPhotoQuestion(transactionId: string): Promise<void> {
  const list = await readPhotoQuestions();
  await writeConfigKey(QUESTIONS, list.filter((q) => q.transactionId !== transactionId));
}

async function remember<T extends { transactionId: string }>(key: string, item: T): Promise<void> {
  const list = await readList<T>(key);
  await writeConfigKey(key, [item, ...list.filter((x) => x.transactionId !== item.transactionId)].slice(0, KEEP));
}

/**
 * A new correction to an entry folded into any earlier one, keeping each
 * change's ORIGINAL "from" — so one Undo puts back the card AND the time the
 * entry was logged with, not just whichever moved last.
 */
export function mergeCorrection(earlier: PhotoCorrection | undefined, next: PhotoCorrection): PhotoCorrection {
  if (!earlier) return next;
  const keepFrom = <T extends { from: string }>(a: T | undefined, b: T | undefined): T | undefined =>
    b && a ? { ...b, from: a.from } : (b ?? a);
  return {
    ...next,
    ts: earlier.ts,
    method: keepFrom(earlier.method, next.method),
    time: keepFrom(earlier.time, next.time),
  };
}

/** Apply a proposal: the card first, then the time. Returns what moved. */
export async function applyProposal(
  transactionId: string,
  proposal: PhotoProposal,
  ctx: Actor,
): Promise<Pick<PhotoCorrection, 'method' | 'time'>> {
  const done: Pick<PhotoCorrection, 'method' | 'time'> = {};
  if (proposal.method) {
    const m = await reassignMethod(transactionId, proposal.method.to, ctx);
    if (m.from !== m.to) done.method = { from: m.from, to: m.to, label: proposal.method.label };
  }
  if (proposal.ts) {
    const t = await retimeTransaction(transactionId, proposal.ts.to, ctx);
    if (t.from !== t.to) done.time = { from: t.from, to: t.to };
  }
  invalidateSnapshot();
  return done;
}

export type CheckOutcome = PhotoVerdict | { kind: 'skipped'; reason: string };

/**
 * Read the photo on an entry and act on what it proves. Never throws: this
 * runs after a response has gone, and a failure costs only the check.
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
      select: 'id,ts,amount,method,category,remarks,verified,deleted',
      limit: 1,
    });
    if (!tx || tx.deleted) return skip('no such entry');

    const capture = await getCapture(captureId);
    if (!capture) return skip('no such photo');
    const object = await getObject(capture.path);
    if (!object) return skip('the photo could not be read from storage');

    let image = { bytes: object.body, mime: capture.mime };
    if (isHeic(capture.mime)) image = { bytes: await heicToJpeg(object.body), mime: 'image/jpeg' };

    const entryTs = String(tx.ts);
    const result = await readReceipts([image], entryTs.slice(0, 10));
    await recordAiUsage(result.usage);
    if (!result.ok) return skip(result.error);

    /* Entries that could be this same payment logged twice: the same amount,
       anywhere a photo's date can land — up to 45 days before the entry, and
       the day after. The rule itself narrows to the photo's own date. */
    const others: OtherEntry[] = (await select('transactions', {
      filters: {
        amount: `eq.${tx.amount}`,
        deleted: 'eq.false',
        id: `neq.${transactionId}`,
        and: `(ts.gte.${addSeconds(entryTs, -46 * 86_400)},ts.lte.${addSeconds(entryTs, 86_400)})`,
      },
      select: 'id,ts,amount,method,category,remarks',
    })).map((o) => ({
      id: o.id, ts: String(o.ts), amount: Number(o.amount),
      method: o.method ?? '', category: o.category ?? '', remarks: o.remarks ?? '',
    }));

    const bankMethods = bankMethodsFrom({ bank_methods: await readConfigKey('bank_methods').catch(() => null) });
    const entry = {
      ts: entryTs, amount: Number(tx.amount), method: tx.method ?? '', verified: Boolean(tx.verified),
      category: tx.category ?? '', remarks: tx.remarks ?? '',
    };
    const verdict = photoVerdict(result.text, entry, bankMethods, others);

    // The reading goes in the log with the verdict: a "keep" with no record
    // of what the model saw cannot be explained afterwards.
    await logEvent('photo.check', { transactionId, captureId, verdict, reading: result.text.slice(0, 300) });

    const summary = { amount: entry.amount, remarks: entry.remarks, ts: entryTs };

    if (verdict.kind === 'ask') {
      await remember<PhotoQuestion>(QUESTIONS, {
        ...summary, transactionId, captureId,
        method: entry.method, category: entry.category,
        proposal: verdict.proposal, duplicate: verdict.duplicate, why: verdict.why, at: nowIST(),
      });
      return verdict;
    }
    if (verdict.kind !== 'apply') return verdict;

    const done = await applyProposal(transactionId, verdict.proposal, { actor: 'photo-check', via });
    if (done.method || done.time) {
      const earlier = (await readPhotoCorrections()).find((c) => c.transactionId === transactionId);
      await remember<PhotoCorrection>(
        CORRECTIONS,
        mergeCorrection(earlier, { ...summary, transactionId, captureId, ...done, at: nowIST() }),
      );
    }
    return verdict;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[photo-check]', transactionId, message);
    return skip(message);
  }
}
