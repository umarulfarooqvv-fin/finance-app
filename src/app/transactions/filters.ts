import type { Transaction } from '@/lib/types';
import { monthKey } from '@/lib/time';
import { looseIncludes } from '@/lib/search-text';

/* ===========================================================================
   Reading a filter set off the URL, and applying it.

   The URL is the state. That is not a stylistic choice: a filtered view of
   money is something you want to send to yourself, reload, or come back to
   from the browser's back button, and every one of those works for free when
   the query string is the only place the selection lives.

   Kept out of page.tsx and free of React so it can be tested directly - a
   filter that silently drops rows is a filter that makes you draw the wrong
   conclusion about a month.
   =========================================================================== */

export type Filters = {
  q: string;
  /** "YYYY-MM", or '' for any month. */
  month: string;
  /** "YYYY-MM-DD", or '' for any day. A day always wins over a month. */
  day: string;
  /** Chosen categories. Empty means any; several mean any OF those. */
  category: string[];
  /** Chosen methods. Empty means any. */
  method: string[];
  /** Inclusive bounds on the absolute amount, or null for unbounded. */
  min: number | null;
  max: number | null;
  upcoming: boolean;
  deleted: boolean;
  page: number;
};

export type RawParams = Record<string, string | string[] | undefined>;

const str = (v: string | string[] | undefined): string =>
  (typeof v === 'string' ? v : '').trim();

/* A multi-valued param, as ONE comma-separated value.

   Repeated keys (?cat=Food&cat=Fuel) would work too, but a single value keeps
   the URL short enough to read and to send to yourself — which is the whole
   reason the filter state lives in the URL at all. Blanks are dropped so a
   trailing comma cannot become a filter matching nothing. */
const list = (v: string | string[] | undefined): string[] => {
  const raw = Array.isArray(v) ? v.join(',') : str(v);
  return [...new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))];
};

/** A bound is only a bound if it is a real, non-negative number. */
function bound(v: string | string[] | undefined): number | null {
  const s = str(v).replace(/[,\s₹]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function readFilters(sp: RawParams): Filters {
  const day = str(sp['day']);
  const month = str(sp['month']);
  return {
    q: str(sp['q']),
    // Anything malformed is ignored rather than applied half-understood.
    month: MONTH_RE.test(month) ? month : '',
    day: DAY_RE.test(day) ? day : '',
    category: list(sp['cat']),
    method: list(sp['method']),
    min: bound(sp['min']),
    max: bound(sp['max']),
    upcoming: str(sp['upcoming']) === '1',
    deleted: str(sp['deleted']) === '1',
    page: Math.max(1, Number(str(sp['page'])) || 1),
  };
}

/** Is anything actually narrowing the list? Drives the "clear all" affordance. */
export function isNarrowed(f: Filters): boolean {
  return Boolean(
    f.q || f.month || f.day || f.category.length > 0 || f.method.length > 0
    || f.min !== null || f.max !== null,
  );
}

/**
 * Does this row match what was typed?
 *
 * Text matches the remarks, category and method. A query that is a NUMBER also
 * matches the amount — typing "649" to find a charge you remember the price of
 * is the obvious thing to try, and before this it silently found nothing.
 *
 * The amount match is a substring of the plain figure, so "649" finds 649.19
 * and 1,649.00 alike. The At least / At most bounds are there for when an
 * exact range is what is wanted; this is for remembering.
 */
function matchesText(t: Transaction, q: string): boolean {
  if (looseIncludes(`${t.remarks} ${t.category} ${t.method}`, q)) return true;

  const digits = q.replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d+)?$/.test(digits)) return false;

  const amount = t.amount;
  if (amount == null) return false;
  // Both forms, so "649" matches 649 and "649.19" matches it too.
  return String(amount).includes(digits) || amount.toFixed(2).includes(digits);
}

export function applyFilters(
  transactions: Transaction[],
  f: Filters,
  now: string,
): Transaction[] {
  return transactions.filter((t) => {
    if (!t.ts) return false;
    if (t.deleted !== f.deleted) return false;
    if (!f.upcoming && t.ts > now) return false;

    // A specific day beats a month; picking both means you meant the day.
    if (f.day) {
      if (t.ts.slice(0, 10) !== f.day) return false;
    } else if (f.month && monthKey(t.ts) !== f.month) return false;

    // Several selected means ANY of them, which is the only reading that makes
    // "Food and Fuel" a wider question rather than an impossible one.
    if (f.category.length > 0 && !f.category.includes(t.category)) return false;
    if (f.method.length > 0 && !f.method.includes(t.method)) return false;

    /* Bounds compare the magnitude. Every amount in this ledger is stored
       positive and the direction lives in `kind`, so a sign test here would
       be comparing against something the data never contains. */
    if (f.min !== null || f.max !== null) {
      const a = Math.abs(t.amount ?? 0);
      if (f.min !== null && a < f.min) return false;
      if (f.max !== null && a > f.max) return false;
    }

    /* Folded, not lower-cased. Remarks that came through the Google Sheet
       carry a curled apostrophe, so "Sheya's" typed into the search box found
       nothing and the row read as deleted rather than as unfindable. */
    if (f.q && !matchesText(t, f.q)) return false;
    return true;
  });
}

/** Build a query string from the current params plus an override. */
export function queryString(sp: RawParams, over: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v) p.set(k, v);
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined || v === '') p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '?';
}
