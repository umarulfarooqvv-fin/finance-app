import type { Day } from '@/lib/time';
import {
  addDays, daysBetween, formatDay, formatMonth, monthEnd, monthKey, monthStart,
} from '@/lib/time';

/* ===========================================================================
   Which stretch of time the Spending page is describing.

   Everything downstream already takes a [from, to] - spendBetween, byCategory,
   byMethod, dailySeries, incomeBetween - so widening the page from "this
   month" to any period is a question of resolving a range, not of changing a
   single calculation. Nothing here decides what counts as spending.

   Two rules it keeps:

   IT NEVER RESOLVES PAST TODAY. A range whose end is in the future would
   divide by days that have not happened, and the per-day figure would drift
   down all month for no reason. `all` and a custom range are both clamped.

   THE COMPARISON MATCHES THE SHAPE OF THE PERIOD. Month against the same days
   of the previous month, year against the same days of the previous year, and
   anything else against the window of equal length immediately before it.
   Comparing 1-13 September against 19-31 August, which a naive "preceding
   window" would do for every period, answers a question nobody asked.
   =========================================================================== */

export type PeriodKind = 'mtd' | 'month' | 'ytd' | 'year' | 'days' | 'range' | 'all';

export type Period = {
  kind: PeriodKind;
  from: Day;
  to: Day;
  /** What to call it on screen. */
  label: string;
  /** Days covered, inclusive, at least 1. */
  days: number;
  /** True only when `to` is today and the period is still filling up. */
  running: boolean;
};

export type RawParams = Record<string, string | string[] | undefined>;

const str = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '').trim();

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;

/** The preset spans offered as one-tap choices. */
export const DAY_PRESETS = [7, 30, 90, 365] as const;

export function presetLabel(n: number): string {
  return n === 365 ? 'Last 12 months' : `Last ${n} days`;
}

const clamp = (d: Day, today: Day): Day => (d > today ? today : d);

/**
 * Resolve the URL into a range.
 *
 * `earliest` is the first day the data covers; it bounds `all` so the chart
 * does not start in 1970. Anything unparseable falls back to month-to-date
 * rather than being half-applied.
 */
export function readPeriod(sp: RawParams, today: Day, earliest: Day): Period {
  const kind = str(sp['p']);

  if (kind === 'month') {
    const m = str(sp['m']);
    if (MONTH_RE.test(m)) {
      const from = monthStart(m);
      const to = clamp(monthEnd(m), today);
      // A month that has not finished is still running, and is labelled as such.
      return mk('month', from, to, formatMonth(m), to === today && monthKey(today) === m);
    }
  }

  if (kind === 'year') {
    const y = str(sp['y']);
    if (YEAR_RE.test(y)) {
      const from: Day = `${y}-01-01`;
      const to = clamp(`${y}-12-31`, today);
      return mk('year', from, to, y, to === today && today.slice(0, 4) === y);
    }
  }

  if (kind === 'ytd') {
    const from: Day = `${today.slice(0, 4)}-01-01`;
    return mk('ytd', from, today, `${today.slice(0, 4)} so far`, true);
  }

  if (kind === 'days') {
    const n = Number(str(sp['n']));
    if (Number.isInteger(n) && n >= 2 && n <= 3650) {
      // Inclusive of today, so "last 7 days" is 7 days and not 8.
      return mk('days', addDays(today, -(n - 1)), today, presetLabel(n), true);
    }
  }

  if (kind === 'range') {
    const from = str(sp['from']);
    const to = str(sp['to']);
    if (DAY_RE.test(from) && DAY_RE.test(to)) {
      // Given backwards, read it forwards rather than returning nothing.
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      const end = clamp(hi, today);
      if (lo <= end) {
        return mk('range', lo, end, `${formatDay(lo)} to ${formatDay(end)}`, end === today);
      }
    }
  }

  if (kind === 'all') {
    const from = earliest <= today ? earliest : today;
    return mk('all', from, today, 'All time', true);
  }

  // Default: the month so far, which is what the page has always shown.
  const key = monthKey(today);
  return mk('mtd', monthStart(key), today, 'This month', true);
}

function mk(kind: PeriodKind, from: Day, to: Day, label: string, running: boolean): Period {
  return { kind, from, to, label, days: Math.max(1, daysBetween(from, to) + 1), running };
}

export type Comparison = { from: Day; to: Day; label: string };

/**
 * The stretch this period should be measured against, or null when comparing
 * would be meaningless.
 */
export function comparisonFor(p: Period): Comparison | null {
  if (p.kind === 'all') return null;

  if (p.kind === 'mtd' || p.kind === 'month') {
    /* The same days of the previous month. A month is compared with a month,
       not with the arbitrary stretch of days that happens to precede it. */
    const prevKey = monthKey(addDays(p.from, -1));
    const from = monthStart(prevKey);
    const span = daysBetween(p.from, p.to);
    const to = minDay(addDays(from, span), monthEnd(prevKey));
    return { from, to, label: `the same ${p.days === 1 ? 'day' : `${p.days} days`} of ${formatMonth(prevKey)}` };
  }

  if (p.kind === 'ytd' || p.kind === 'year') {
    const year = Number(p.from.slice(0, 4)) - 1;
    const from: Day = `${year}-01-01`;
    /* Step back a year by label, not by 365 days: across a leap year the day
       count differs, and "the same period last year" means the same dates. */
    const to = minDay(shiftYear(p.to, -1), `${year}-12-31`);
    return { from, to, label: `the same period of ${year}` };
  }

  // Any other span is compared with the equal-length span immediately before.
  const to = addDays(p.from, -1);
  return { from: addDays(to, -(p.days - 1)), to, label: `the previous ${p.days} days` };
}

const minDay = (a: Day, b: Day): Day => (a < b ? a : b);

/** Same month and day, n years away; 29 Feb lands on 28 Feb in a common year. */
function shiftYear(d: Day, n: number): Day {
  const y = Number(d.slice(0, 4)) + n;
  const md = d.slice(5);
  if (md === '02-29') {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return `${y}-02-${leap ? '29' : '28'}`;
  }
  return `${y}-${md}`;
}

/**
 * Day-by-day is unreadable past a quarter or so — 365 columns two pixels wide
 * say nothing. Beyond that the page shows months instead.
 */
export function granularity(p: Period): 'day' | 'month' {
  return p.days > 92 ? 'month' : 'day';
}

/** Build a query string for a period link, dropping the keys it does not use. */
export function periodHref(over: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(over)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/spending?${s}` : '/spending';
}
