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
  category: string;
  method: string;
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
    category: str(sp['cat']),
    method: str(sp['method']),
    min: bound(sp['min']),
    max: bound(sp['max']),
    upcoming: str(sp['upcoming']) === '1',
    deleted: str(sp['deleted']) === '1',
    page: Math.max(1, Number(str(sp['page'])) || 1),
  };
}

/** Is anything actually narrowing the list? Drives the "clear all" affordance. */
export function isNarrowed(f: Filters): boolean {
  return Boolean(f.q || f.month || f.day || f.category || f.method || f.min !== null || f.max !== null);
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

    if (f.category && t.category !== f.category) return false;
    if (f.method && t.method !== f.method) return false;

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
    if (f.q && !looseIncludes(`${t.remarks} ${t.category} ${t.method}`, f.q)) return false;
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
