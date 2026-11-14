import { parseImport } from '@/lib/import-parse';
import { described, ruleFor, type CategoryRule } from '@/lib/category-rules';
import { PROMPT_EXAMPLE_WHEN } from '@/lib/import-prompt';
import { dateFromReading } from '@/lib/capture-entry';
import { foldForSearch } from '@/lib/search-text';
import { validateTransaction } from '@/lib/validation';
import { joinTags } from '@/lib/user-tags';
import { dayOf, secondsBetween } from '@/lib/time';
import type { BankMethods } from '@/lib/bank-methods';
import type { Place } from '@/lib/place';
import type { Instant } from '@/lib/time';
import type { Transaction } from '@/lib/types';

/* ===========================================================================
   Photos the AI has read, and what becomes of each row.

   THE OWNER ASKED FOR THESE TO BE ADDED WITHOUT BEING ASKED: a draft waiting
   for a tap was a draft forgotten, and forty-three of them piled up. So a row
   read off a photo now becomes an entry by itself (lib/draft-auto) — with
   whatever was read, a missing category or payment asked for afterwards —
   UNLESS one of the checks below says a person has to look first:

     - no amount was read: there is nothing to add
     - the date could not be trusted: a row dated by guess lands in the wrong
       statement, and its duplicate check would look on the wrong day (this
       includes a row carrying the prompt's own example date, copied out by
       a model that had none to read)
     - neither what paid nor what for was read: a screen that shows neither
       is not recognisably a payment ("Total spent ₹47,16,014" was one)
     - AN ENTRY ALREADY ON FILE LOOKS LIKE THIS PAYMENT. The same amount at
       the same moment on the same card is the same payment; the same amount
       on the same day is a question. Neither is added.

   This module decides; it writes nothing. Pure: the readings, the photos and
   the ledger in, drafts with a verdict out.

   Only money spent. A row read as money received belongs on Income and is
   left to the inbox's Review, which can file it there.
   =========================================================================== */

/** Why a row is waiting for a person instead of being added. */
export type DraftHold = 'no-amount' | 'date' | 'unreadable' | 'duplicate' | 'maybe-duplicate';

export type DraftVerdict =
  | { add: true; missing: ('method' | 'category')[] }
  | { add: false; why: DraftHold };

export type DraftTwin = {
  /** The entry's id — null while the twin is itself a draft about to be added. */
  id: string | null;
  ts: Instant;
  remarks: string;
  method: string;
  amount: number;
  /** Same amount, same moment (or same day and name), no other card: certain. */
  sure: boolean;
};

export type DraftEntry = {
  /** `${captureId}\u0000${raw}` — stable while the reading is unchanged. */
  key: string;
  captureId: string;
  /** The row's own text in the reading; how it is found again. */
  raw: string;
  ts: Instant;
  amount: number | null;
  method: string;
  category: string;
  remarks: string;
  tags: string[];
  /** Amount, payment and category are all known. */
  complete: boolean;
  /** One line about the date, when it needed a judgement. */
  dateNote: string | null;
  /** An entry already on file that looks like this one. */
  duplicateOf: DraftTwin | null;
  /** Added by itself, or held for a person — and why. */
  auto: DraftVerdict;
  /** The photo's size, for the form's photo field. */
  bytes: number;
  /** Where the phone was when the photo was taken, if the Shortcut sent it. */
  place: Place | null;
  /** The owner's rule that gave the category (lib/category-rules), if one did. */
  ruled: string | null;
};

export type Reading = { text?: string; hidden?: string[] };

/** Moments closer than this are one payment: a screenshot, then the log. */
const SAME_MOMENT_SECONDS = 10 * 60;

/* An entry written with a date and no time is stored at noon (and a pre-logged
   instalment at midnight). Its time says nothing about when it was paid, so it
   cannot disagree with the photo's. */
const untimed = (ts: string) => /T(?:12|00):00:00$/.test(ts);

const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'paid', 'payment', 'upi', 'bill']);
const words = (s: string) =>
  new Set(foldForSearch(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));
const sharesWord = (a: string, b: string) => {
  const mine = words(a);
  for (const w of words(b)) if (mine.has(w)) return true;
  return false;
};

const paise = (n: number) => Math.round(n * 100);

type Known = { id: string | null; ts: Instant; amount: number; method: string; remarks: string };

/**
 * The entry already on file that this row may be, or null.
 *
 * SURE — nothing to ask: the same amount, no other card named, and either
 * the same moment, or the same day with the same name where one side has no
 * real time to compare (an entry typed in later sits at noon).
 *
 * Otherwise any entry of the same amount that day is a maybe: two teas at
 * ₹40 do happen, and so does one tea logged from habit on the wrong card.
 * A person can tell which in a second; the ledger cannot.
 */
export function findTwin(
  row: { ts: Instant; timed: boolean; amount: number; method: string; remarks: string },
  known: Known[],
): DraftTwin | null {
  let best: { k: Known; sure: boolean; gap: number } | null = null;
  for (const k of known) {
    if (paise(k.amount) !== paise(row.amount)) continue;
    const gap = Math.abs(secondsBetween(k.ts, row.ts));
    const bothTimed = row.timed && !untimed(k.ts);
    const close = bothTimed && gap <= SAME_MOMENT_SECONDS;
    if (dayOf(k.ts) !== dayOf(row.ts) && !close) continue;

    const otherCard = Boolean(row.method && k.method && row.method !== k.method);
    const sure = !otherCard && (close || (!bothTimed && sharesWord(row.remarks, k.remarks)));
    if (!best || (sure && !best.sure) || (sure === best.sure && gap < best.gap)) best = { k, sure, gap };
  }
  if (!best) return null;
  const { k, sure } = best;
  return { id: k.id, ts: k.ts, remarks: k.remarks, method: k.method, amount: k.amount, sure };
}

export function draftEntries(
  captures: { id: string; ts: string; bytes: number }[],
  readings: Record<string, Reading>,
  bankMethods: BankMethods,
  transactions: Transaction[],
  places: Record<string, Place> = {},
  /** IST date, for the "too far ahead" rule a saved entry must pass. */
  today: string = '9990-01-01',
  /** The owner's "these words are this category" rules; fill a blank only. */
  rules: CategoryRule[] = [],
): DraftEntry[] {
  // What a row is compared against: every live entry, then each draft that
  // will itself be added — two photos of one payment must not become two.
  const known: Known[] = [];
  for (const t of transactions) {
    if (t.deleted || !t.ts || t.amount == null) continue;
    known.push({ id: t.id, ts: t.ts, amount: t.amount, method: t.method, remarks: t.remarks || t.category });
  }

  type Pending = Omit<DraftEntry, 'duplicateOf' | 'auto'> & { timed: boolean; dateDoubtful: boolean };
  const pending: Pending[] = [];
  for (const c of captures) {
    const r = readings[c.id];
    if (!r?.text) continue;
    const hidden = new Set(r.hidden ?? []);
    const { rows } = parseImport(r.text, { bankMethods });
    for (const row of rows) {
      if (row.direction !== 'out' || hidden.has(row.raw)) continue;
      const dated = dateFromReading(row.day, row.time, c.ts as Instant);
      const amount = row.amount > 0 ? row.amount : null;
      // The prompt's own example moment, copied out instead of a date read.
      const parroted = row.day === PROMPT_EXAMPLE_WHEN.day && row.time === PROMPT_EXAMPLE_WHEN.time;
      // The owner's rule for the name: its category fills a blank one only;
      // its description goes in front of the name the photo showed.
      const rule = ruleFor(row.remarks, rules);
      const category = row.category || rule?.category || '';
      const remarks = described(row.remarks, rule);
      const ruleUsed = rule && (!row.category || remarks !== row.remarks) ? rule : null;
      pending.push({
        key: `${c.id}\u0000${row.raw}`,
        captureId: c.id,
        raw: row.raw,
        ts: dated.ts,
        amount,
        method: row.method,
        category,
        remarks,
        tags: row.tags,
        complete: amount != null && Boolean(row.method) && Boolean(category),
        dateNote: parroted
          ? 'This date is the example the AI was shown, not one it read'
          : dated.yearCorrected
          ? 'Year read off the photo did not fit — taken as the photo’s year'
          : dated.dateDoubtful
            ? 'Date on the photo looked wrong — dated when the photo was taken'
            : null,
        bytes: c.bytes,
        place: places[c.id] ?? null,
        ruled: ruleUsed?.words ?? null,
        // A time printed on the screen, or the photo's own moment that day.
        timed: row.time !== null || dated.ts === c.ts,
        dateDoubtful: dated.dateDoubtful || parroted,
      });
    }
  }

  // Oldest first, so of two photos of one payment the earlier is the entry
  // and the later is its duplicate — whichever order they are listed in.
  pending.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.key < b.key ? -1 : 1));

  const out: DraftEntry[] = [];
  for (const { timed, dateDoubtful, ...d } of pending) {
    const twin = d.amount == null ? null : findTwin({ ts: d.ts, timed, amount: d.amount, method: d.method, remarks: d.remarks || d.category }, known);

    let auto: DraftVerdict;
    if (d.amount == null) auto = { add: false, why: 'no-amount' };
    // A twin first: "you already have this" is the more useful thing to say.
    else if (twin) auto = { add: false, why: twin.sure ? 'duplicate' : 'maybe-duplicate' };
    else if (dateDoubtful) auto = { add: false, why: 'date' };
    else if (!d.method && !d.category) auto = { add: false, why: 'unreadable' };
    else if (gapErrors(entryInput(d), today)) auto = { add: false, why: 'unreadable' };
    else {
      const missing: ('method' | 'category')[] = [];
      if (!d.method) missing.push('method');
      if (!d.category) missing.push('category');
      auto = { add: true, missing };
      known.push({ id: null, ts: d.ts, amount: d.amount, method: d.method, remarks: d.remarks || d.category });
    }
    out.push({ ...d, duplicateOf: twin, auto });
  }
  return out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

/** The entry a draft row saves as. */
export function entryInput(d: { ts: Instant; amount: number | null; method: string; category: string; remarks: string; tags: string[] }) {
  return { amount: d.amount, method: d.method, category: d.category, remarks: joinTags(d.remarks, d.tags), ts: d.ts };
}

/**
 * The ordinary entry rules, forgiving a BLANK payment and a BLANK category
 * and nothing else — the same exception /import makes for an unsorted row,
 * one field wider, and only for a row read off a photo. Blank means "not
 * known yet", and the entry is listed for a person to complete; an amount of
 * a crore or a date that is not a date is still refused.
 */
export function gapErrors(input: ReturnType<typeof entryInput>, today: string): Record<string, string> | null {
  const errors = { ...(validateTransaction(input, today) ?? {}) };
  if (!input.method.trim()) delete errors['method'];
  if (!input.category.trim()) delete errors['category'];
  return Object.keys(errors).length ? errors : null;
}

/** Entries added from a photo that still lack what paid or what it was for. */
export function needingDetail(transactions: Transaction[], source: string): Transaction[] {
  return transactions
    .filter((t) => !t.deleted && t.ts && t.source === source && (!t.method.trim() || !t.category.trim()))
    .sort((a, b) => (a.ts! < b.ts! ? 1 : -1));
}
