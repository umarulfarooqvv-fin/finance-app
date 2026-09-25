import { evaluateAmount } from '@/lib/calc';
import { foldForSearch } from '@/lib/search-text';
import { ALL_CATEGORIES } from '@/lib/types';
import { resolveMethod, type BankMethods } from '@/lib/bank-methods';
import type { Day } from '@/lib/time';

/* ===========================================================================
   Reading a pasted batch of entries.

   The shape is the one lib/csv already uses for the archive —
   date | amount | method | category | description — so this app has one row
   shape rather than two that have to be remembered apart.

   NOTHING IS EVER DROPPED. A line that cannot be read comes back in `skipped`
   with the reason, and a line that reads but is incomplete comes back as a row
   with `issues` on it. Silently losing a line loses money, and a batch that
   quietly imports nineteen of twenty rows is worse than one that refuses:
   the missing row is discovered months later, if at all.

   A METHOD OR CATEGORY IT CANNOT MATCH IS LEFT EMPTY rather than guessed at.
   The table that follows makes the person fill it, which is the same rule the
   voice parser and the statement drafts already follow.
   =========================================================================== */

export type ImportIssue = 'no-method' | 'no-category' | 'unknown-method' | 'unknown-category';

export type ImportRow = {
  /** 1-based line in the pasted text, so a row can be found again. */
  line: number;
  raw: string;
  day: Day;
  /** "HH:MM:SS" when the date column carried a time, else null — and the
      caller supplies its usual noon. A payment screen prints "3:11 PM", and
      the moment a charge happened decides which statement it is on when it
      lands on a bill date. */
  time: string | null;
  amount: number;
  method: string;
  category: string;
  remarks: string;
  /** What still needs a person. Empty means ready to save. */
  issues: ImportIssue[];
};

export type ImportSkip = { line: number; raw: string; why: string };

export type ImportParse = {
  rows: ImportRow[];
  skipped: ImportSkip[];
};

/* Pipes first, because the prompt asks for them and a description may itself
   contain a comma. Tabs next, for a spreadsheet paste. Two-or-more spaces
   last, for text copied out of a PDF — a single space is not a separator,
   because descriptions have spaces in them. */
function splitFields(line: string): string[] {
  if (line.includes('|')) return line.split('|').map((c) => c.trim());
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  return line.split(/\s{2,}/).map((c) => c.trim());
}

const DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$|^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/i;

/** "15:11", "3:11 PM", "03.11pm", "15:11:07" → "HH:MM:SS". Null if not a time. */
function toTime(text: string): string | null {
  const m = TIME.exec(text.trim());
  if (!m) return null;
  const twelve = m[4] !== undefined;
  let h = Number(twelve ? m[1] : m[5]);
  const min = Number(twelve ? m[2] : m[6]);
  const sec = Number((twelve ? m[3] : m[7]) ?? 0);
  if (twelve) {
    if (h < 1 || h > 12) return null;
    const pm = m[4]!.toLowerCase() === 'p';
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (h > 23 || min > 59 || sec > 59) return null;
  return `${pad(h)}:${pad(min)}:${pad(sec)}`;
}

/** The date column, split into its date and an optional time after it. */
function splitDateTime(text: string): { date: string; time: string } {
  const t = text.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})[T\s]+(.+)$/.exec(t);
  if (iso) return { date: iso[1]!, time: iso[2]! };
  const [date = '', ...rest] = t.split(/\s+/);
  return { date, time: rest.join(' ') };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** A real calendar day, or null. Rejects 31 Feb rather than rolling it over. */
function toDay(text: string, dateOrder: 'dmy' | 'mdy'): Day | null {
  const t = text.trim();

  const iso = ISO.exec(t);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const m = DATE.exec(t);
  if (!m) return null;

  const a = Number(m[1]);
  const b = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;

  const [day, month] = dateOrder === 'dmy' ? [a, b] : [b, a];
  return valid(year, month, day);
}

function valid(y: number, m: number, d: number): Day | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Rolling 31 Feb into 3 March would date an entry in the wrong month and
  // therefore on the wrong statement.
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Match a method or category loosely, so casing and punctuation do not matter. */
function match(value: string, allowed: readonly string[]): string | null {
  const q = foldForSearch(value);
  if (!q) return null;
  return allowed.find((a) => foldForSearch(a) === q) ?? null;
}

export function parseImport(
  text: string,
  opts: { dateOrder?: 'dmy' | 'mdy'; bankMethods?: BankMethods } = {},
): ImportParse {
  const dateOrder = opts.dateOrder ?? 'dmy';
  const bankMethods = opts.bankMethods ?? {};
  const rows: ImportRow[] = [];
  const skipped: ImportSkip[] = [];

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === '') return;

    const fields = splitFields(trimmed);
    if (fields.length < 2) {
      skipped.push({ line, raw, why: 'not enough columns' });
      return;
    }

    const [dateRaw = '', amountRaw = '', methodRaw = '', categoryRaw = '', ...rest] = fields;

    /* A header the assistant added anyway, or a spreadsheet's own. Detected by
       the date column failing AND the word looking like a label, so a genuine
       unreadable date is still reported rather than silently treated as
       furniture. */
    if (/^(date|day|timestamp)$/i.test(dateRaw)) return;

    const when = splitDateTime(dateRaw);
    const day = toDay(when.date, dateOrder);
    // A time that cannot be read costs the time, not the row: it falls back to
    // the caller's noon exactly as if none had been given.
    const time = when.time ? toTime(when.time) : null;
    if (!day) {
      skipped.push({ line, raw, why: `could not read the date "${dateRaw}"` });
      return;
    }

    /* The currency word a receipt prints — "Rs. 380", "INR 380" — is not part
       of the number. "₹" already passes; the words used to cost the whole row. */
    const parsed = evaluateAmount(amountRaw.replace(/^\s*(?:rs\.?|inr)\s*/i, ''));
    if (!parsed.ok) {
      skipped.push({ line, raw, why: `could not read the amount "${amountRaw}"` });
      return;
    }
    if (parsed.amount <= 0) {
      skipped.push({ line, raw, why: 'amount is zero or negative' });
      return;
    }

    const issues: ImportIssue[] = [];

    /* The method column may hold the BANK's own label — "Federal 2788" — rather
       than this app's name for the account, because that is what a UPI history
       prints. The configured mapping turns one into the other; an unmapped or
       ambiguous label is still reported rather than guessed at. */
    let method = '';
    if (methodRaw.trim() === '' || /^unreadable$/i.test(methodRaw)) {
      issues.push('no-method');
    } else {
      const hit = resolveMethod(methodRaw, bankMethods);
      if (hit) method = hit;
      else issues.push('unknown-method');
    }

    let category = '';
    if (categoryRaw.trim() === '' || /^unreadable$/i.test(categoryRaw)) {
      issues.push('no-category');
    } else {
      const hit = match(categoryRaw, ALL_CATEGORIES);
      if (hit) category = hit;
      else issues.push('unknown-category');
    }

    rows.push({
      line,
      raw,
      day,
      time,
      amount: parsed.amount,
      method,
      category,
      // Everything after the four known columns, so a description containing a
      // pipe survives instead of being cut at it.
      remarks: rest.join(' | ').trim(),
      issues,
    });
  });

  return { rows, skipped };
}

/**
 * True when every row can be saved.
 *
 * A METHOD IS REQUIRED; a category is not. Without a method the money lands
 * on no card and no account, so the row would be recorded and still be wrong
 * everywhere it matters. A missing category only means the expense is not
 * filed yet: it still counts against the card, it is flagged for review, and
 * it can be sorted later — which is far better than refusing the batch and
 * leaving the expense recorded nowhere at all.
 */
export function readyToImport(rows: ImportRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.method !== '');
}

/** Rows that will go in unfiled, so the page can say how many before saving. */
export function unsortedCount(rows: ImportRow[]): number {
  return rows.filter((r) => r.category === '').length;
}
