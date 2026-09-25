import { parseImport } from '@/lib/import-parse';
import type { BankMethods } from '@/lib/bank-methods';
import { dayFromNumber, dayNumber, daysBetween, dayOf, type Day, type Instant } from '@/lib/time';

/* ===========================================================================
   Turning a photo's reading into a filled-in entry form.

   The inbox's "Entry" button used to open a blank form beside a photo whose
   rows had already been read — asking a person to retype what the app had
   just finished reading for them. This fills the form instead, and it is
   still only a DRAFT: every field is editable, nothing is saved until "Add
   entry", and a field the reading could not settle (an unknown method, an
   unreadable category) comes through empty so the form goes on refusing to
   submit until a person supplies it.

   ONE ROW ONLY. A photo of a bill with three lines on it is three entries,
   and one form cannot hold them — that is what "Review rows" and /import are
   for. Picking the first of three and silently dropping the rest would be
   worse than filling nothing.
   =========================================================================== */

/** How far before the photo a read date may fall and still be believed. */
const PLAUSIBLE_DAYS = 45;

export type EntryDraft = {
  ts: Instant;
  amount?: number;
  method?: string;
  category?: string;
  remarks?: string;
};

export type FromReading =
  | {
    kind: 'one';
    draft: EntryDraft;
    /** The read date was used, not the photo's. */
    datedByReading: boolean;
    /** The day and month were read, but the year was replaced with the photo's. */
    yearCorrected: boolean;
    /** A date was read but did not look right, so the photo's was kept. */
    dateDoubtful: boolean;
  }
  | { kind: 'several'; rows: number }
  | { kind: 'none' };

/**
 * The form a single-row reading fills in.
 *
 * THE DATE is the one field that needs judgement. A screenshot is usually
 * taken after the fact — a UPI confirmation looked at the next morning — so
 * the date printed on it is truer than the moment it was photographed. But a
 * model misreading "2026" as "2025" would file the entry a year back, into a
 * statement long since paid, where nobody would think to look. So the read
 * date is used only when it falls on or up to PLAUSIBLE_DAYS before the photo;
 * anything else — in the future, or implausibly old — keeps the photo's own
 * timestamp, which is at least certainly close.
 */
/**
 * The same day and month in a believable year, or null.
 *
 * A payment screen prints "September 22" with no year, and a model asked to
 * write one will invent it. The day and month are what was on the screen; the
 * year is the made-up part. So a date that is implausible AS READ gets one
 * more chance with the photo's year, then the year before (a January photo of
 * a December payment) — and is refused if neither lands in the window.
 */
function withBelievableYear(day: Day, captureDay: Day): Day | null {
  const year = Number(captureDay.slice(0, 4));
  for (const y of [year, year - 1]) {
    const candidate = `${y}${day.slice(4)}`;
    // 29 February in a year without one would roll into March.
    if (dayFromNumber(dayNumber(candidate)) !== candidate) continue;
    const gap = daysBetween(candidate, captureDay);
    if (gap >= 0 && gap <= PLAUSIBLE_DAYS) return candidate;
  }
  return null;
}

export function entryFromReading(
  text: string,
  captureTs: Instant,
  bankMethods: BankMethods = {},
): FromReading {
  const { rows } = parseImport(text, { bankMethods });
  if (rows.length === 0) return { kind: 'none' };
  if (rows.length > 1) return { kind: 'several', rows: rows.length };

  const row = rows[0]!;
  const captureDay: Day = dayOf(captureTs);
  const gap = daysBetween(row.day, captureDay);
  const asRead = gap >= 0 && gap <= PLAUSIBLE_DAYS;
  const repaired = asRead ? null : withBelievableYear(row.day, captureDay);
  const day = asRead ? row.day : repaired;

  // Same day as the photo: the photo's own time is the best time there is.
  // An earlier day: noon, like every other date written without a time — an
  // entry at 00:00 on a bill date sits on the boundary between two statements.
  const ts = !day || day === captureDay ? captureTs : `${day}T12:00:00`;

  const draft: EntryDraft = { ts };
  if (row.amount > 0) draft.amount = row.amount;
  if (row.method) draft.method = row.method;
  if (row.category) draft.category = row.category;
  if (row.remarks) draft.remarks = row.remarks;

  return {
    kind: 'one',
    draft,
    datedByReading: day !== null && day !== captureDay,
    yearCorrected: repaired !== null,
    dateDoubtful: day === null,
  };
}
