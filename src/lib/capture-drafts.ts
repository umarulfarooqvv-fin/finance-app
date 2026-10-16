import 'server-only';
import { readConfigKey, updateConfigKey } from '@/lib/config';
import { getCapture } from '@/lib/captures';
import { getObject } from '@/lib/storage';
import { readReceipts, visionConfigured } from '@/lib/ai/vision';
import { nowIST } from '@/lib/time';
import { heicToJpeg, isHeic } from '@/lib/image-convert';
import { describeUsage, isLimited } from '@/lib/ai/usage';
import { readAiUsage, recordAiUsage } from '@/lib/ai/usage-store';

/* ===========================================================================
   What the AI read out of a photo, kept until the photo becomes an entry.

   A capture arrives from the phone with no time to type anything, so the read
   happens WITHOUT being asked: /api/capture schedules it the moment the photo
   lands, and by the time the inbox is opened the rows are already sitting
   there waiting to be confirmed. That is the whole point — the backlog stays
   a backlog precisely because every photo needs a person before it becomes
   anything.

   STORED, NOT RECOMPUTED. A photo can sit in the inbox for a week; re-reading
   it on every page visit would burn a free tier's quota on an answer that
   cannot have changed. The photo's bytes are immutable (its id is their
   hash), so its reading is too.

   IT IS A DRAFT AND ONLY A DRAFT. This writes no transaction, marks no
   capture used, and settles nothing. The text lands on /import, in the same
   table a paste lands in, and stops there until a person presses Import.

   Lives in app_config rather than a column on `captures`, alongside the other
   JSON this table already holds (card settings, holdings, credit status). It
   is small and bounded — one entry per PENDING capture — and pruned when a
   capture is used or discarded, so it does not need a migration and the
   generated row types stay exactly as Postgres reports them.
   =========================================================================== */

const KEY = 'capture_drafts';

export type CaptureDraft = {
  /** Pipe-delimited rows, in the shape a person would have pasted. */
  text?: string;
  /** Set instead of `text` when the read failed, so the inbox can say why. */
  error?: string;
  /** When it was read. IST wall clock, like every other timestamp here. */
  at: string;
  /**
   * The provider's limit stopped it — NOT a verdict on this photo. Never
   * stored: a stored error sticks to the photo until somebody presses Retry,
   * whereas an unread photo is picked up again by the next visit once the
   * limit lifts, which is the whole point of reading without being asked.
   */
  limited?: boolean;
  /**
   * Rows already made into entries from the drafts on Entries, and the entry
   * each became. The row is cut out of `text` at the same moment, so neither
   * the inbox nor Entries can offer it a second time; the first entry is the
   * one the photo is linked to once every row has been dealt with.
   */
  added?: { raw: string; tx: string }[];
  /** Rows hidden from Entries ("not now"). The inbox still shows the photo. */
  hidden?: string[];
};

export type CaptureDrafts = Record<string, CaptureDraft>;

export async function readCaptureDrafts(): Promise<CaptureDrafts> {
  try {
    return (await readConfigKey<CaptureDrafts>(KEY)) ?? {};
  } catch {
    // Corrupt JSON here must not take the inbox down with it — the photos are
    // still there, and a failed read is recoverable by reading again.
    return {};
  }
}

/**
 * Store what was read, merging into whatever else is there.
 *
 * Several at once where possible: this is a read-modify-write on one config
 * key, so two of them overlapping can lose one side's entry. Writing a whole
 * batch in one go is what keeps that window small. A lost draft is not lost
 * data — the photo is untouched, the inbox shows it as unread, and the next
 * visit reads it again — but there is no reason to invite it.
 */
export async function saveCaptureDrafts(batch: CaptureDrafts): Promise<void> {
  const keep = Object.fromEntries(Object.entries(batch).filter(([, d]) => !d.limited));
  if (Object.keys(keep).length === 0) return;
  await updateConfigKey<CaptureDrafts>(KEY, (current) => ({ ...current, ...keep }));
}

export async function saveCaptureDraft(id: string, draft: CaptureDraft): Promise<void> {
  await saveCaptureDrafts({ [id]: draft });
}

/** Drop drafts for captures that are no longer waiting. */
export async function forgetCaptureDrafts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await updateConfigKey<CaptureDrafts>(KEY, (current) => {
    const next = { ...current };
    for (const id of ids) delete next[id];
    return next;
  });
}

/**
 * Read one capture's photo into rows, WITHOUT storing the answer.
 *
 * One photo per call rather than several together, because captures arrive
 * one at a time, minutes apart — there is no batch to wait for. The prompt's
 * "several payments, one occasion" grouping is lost across photos that way,
 * which is why /import keeps its bulk edit: tick the rows from a hospital
 * afternoon and set the description once.
 *
 * Returns what it read, or null when there is nothing to read — no vision
 * provider configured, or no such capture.
 */
export async function readCapture(id: string): Promise<CaptureDraft | null> {
  if (!visionConfigured()) return null;

  const row = await getCapture(id);
  if (!row) return null;

  /* While a limit is in force, asking again only spends another request to
     be told no — and on a daily limit, every inbox visit would. */
  const now = nowIST();
  const usage = await readAiUsage();
  if (isLimited(usage, now)) {
    return { error: describeUsage(usage, now)!.text, at: now, limited: true };
  }

  const object = await getObject(row.path);
  if (!object) {
    return { error: 'The photo could not be read from storage.', at: nowIST() };
  }

  // Its own day, not today's: a backlog photo read a week late is still dated
  // by when it was taken.
  /* A photo stored as HEIC before arrivals were converted is converted in
     memory for the read — the model cannot open HEIC. */
  let image = { bytes: object.body, mime: row.mime };
  if (isHeic(row.mime)) {
    try {
      image = { bytes: await heicToJpeg(object.body), mime: 'image/jpeg' };
    } catch {
      /* readReceipts then explains that HEIC cannot be read */
    }
  }
  const result = await readReceipts([image], row.ts.slice(0, 10));
  await recordAiUsage(result.usage);
  if (result.ok) return { text: result.text, at: nowIST() };
  return { error: result.error, at: nowIST(), limited: isLimited(result.usage, nowIST()) };
}

/** Read one photo and store the answer. The path a newly-arrived photo takes. */
export async function readCaptureIntoDraft(id: string): Promise<CaptureDraft | null> {
  const draft = await readCapture(id);
  if (draft && !draft.limited) await saveCaptureDraft(id, draft);
  return draft;
}

/** The reading's text without one row — the first line that is that row. */
export function withoutRow(text: string, raw: string): string {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim() === raw.trim());
  if (i >= 0) lines.splice(i, 1);
  else return text.replace(raw, '');
  return lines.join('\n');
}

/**
 * One row of a photo became an entry: cut it from the reading and remember
 * the entry. Returns what is left to read, and the first entry made, so the
 * caller can retire the photo once nothing is left.
 */
export async function consumeDraftRow(
  captureId: string,
  raw: string,
  tx: string,
): Promise<{ remaining: string; firstTx: string } | null> {
  let out: { remaining: string; firstTx: string } | null = null;
  await updateConfigKey<CaptureDrafts>(KEY, (current) => {
    const d = current[captureId];
    if (!d?.text) return current;
    const remaining = withoutRow(d.text, raw);
    const added = [...(d.added ?? []), { raw, tx }];
    out = { remaining, firstTx: added[0]!.tx };
    return { ...current, [captureId]: { ...d, text: remaining, added } };
  });
  return out;
}

/** Stop listing one row on Entries. Nothing else changes. */
export async function hideDraftRow(captureId: string, raw: string): Promise<void> {
  await updateConfigKey<CaptureDrafts>(KEY, (current) => {
    const d = current[captureId];
    if (!d) return current;
    return { ...current, [captureId]: { ...d, hidden: [...new Set([...(d.hidden ?? []), raw])] } };
  });
}
