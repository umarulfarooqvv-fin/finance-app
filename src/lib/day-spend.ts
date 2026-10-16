import { isSpend } from '@/lib/analytics';
import { round2 } from '@/lib/money';
import {
  addDays, daysBetween, endOfDay, formatDay, formatMonth, monthEnd, monthKey, monthStart, startOfDay, weekdayIndex,
  type Day,
} from '@/lib/time';
import type { Snapshot, TxKind } from '@/lib/types';

/* ===========================================================================
   "What did I spend …?" on Today for a span of days — today, yesterday, a week, a
   month — and the same figure for the span just before it, for comparison.

   Weeks run Monday to Sunday, like the calendar the owner reads. Pure: the
   day "today" is passed in; nothing here reads a clock.
   =========================================================================== */

export const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['this-week', 'This week'],
  ['last-week', 'Last week'],
  ['this-month', 'This month'],
  ['last-month', 'Last month'],
] as const;

export type SpanPreset = (typeof PRESETS)[number][0];

export type Span = {
  /** A preset, or 'day' for one chosen date. */
  key: SpanPreset | 'day';
  label: string;
  from: Day;
  to: Day;
  /** The span before it, of the same shape — yesterday for today, last month for this. */
  prev: { from: Day; to: Day; label: string };
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function spanFor(p: string | undefined, today: Day, day?: string): Span {
  if (p === 'day' && day && DAY_RE.test(day) && day <= today) {
    return { key: 'day', label: formatDay(day), from: day, to: day, prev: { from: addDays(day, -1), to: addDays(day, -1), label: 'the day before' } };
  }
  const monday = addDays(today, -weekdayIndex(today));
  const thisMonth = monthKey(today);
  const lastMonth = monthKey(addDays(monthStart(thisMonth), -1));
  switch (p) {
    case 'yesterday': {
      const y = addDays(today, -1);
      return { key: 'yesterday', label: 'Yesterday', from: y, to: y, prev: { from: addDays(y, -1), to: addDays(y, -1), label: 'the day before' } };
    }
    case 'this-week': {
      // So far this week, against the same days of last week.
      const n = daysBetween(monday, today);
      return { key: 'this-week', label: 'This week', from: monday, to: today, prev: { from: addDays(monday, -7), to: addDays(monday, n - 7), label: 'same days last week' } };
    }
    case 'last-week': {
      const from = addDays(monday, -7);
      return { key: 'last-week', label: 'Last week', from, to: addDays(from, 6), prev: { from: addDays(from, -7), to: addDays(from, -1), label: 'the week before' } };
    }
    case 'this-month': {
      // So far this month, against the same days of last month.
      const from = monthStart(thisMonth);
      const n = daysBetween(from, today);
      const pFrom = monthStart(lastMonth);
      const pTo = addDays(pFrom, n) > monthEnd(lastMonth) ? monthEnd(lastMonth) : addDays(pFrom, n);
      return { key: 'this-month', label: 'This month', from, to: today, prev: { from: pFrom, to: pTo, label: 'same days last month' } };
    }
    case 'last-month': {
      const before = monthKey(addDays(monthStart(lastMonth), -1));
      return {
        key: 'last-month', label: formatMonth(lastMonth), from: monthStart(lastMonth), to: monthEnd(lastMonth),
        prev: { from: monthStart(before), to: monthEnd(before), label: formatMonth(before) },
      };
    }
    default:
      return { key: 'today', label: 'Today', from: today, to: today, prev: { from: addDays(today, -1), to: addDays(today, -1), label: 'yesterday' } };
  }
}

export type SpanEntry = {
  id: string; ts: string; day: Day; amount: number; method: string; category: string;
  remarks: string; tags: string[]; kind: TxKind;
};

export type SpanSummary = {
  spent: number;
  prevSpent: number;
  /** Number of spend entries. */
  count: number;
  days: number;
  perDay: number;
  /** Money that left but was not consumed. */
  billsPaid: number;
  lent: number;
  saved: number;
  received: number;
  categories: { key: string; total: number; share: number }[];
  /** Every entry in the span, newest first. */
  entries: SpanEntry[];
};

export function spanSummary(snap: Snapshot, span: Span): SpanSummary {
  const lo = startOfDay(span.from);
  const hi = endOfDay(span.to);
  const inSpan = (ts: string | null, a: string, b: string) => ts !== null && ts >= a && ts <= b;

  const txs = snap.transactions.filter((t) => !t.deleted && t.amount != null && inSpan(t.ts, lo, hi));
  const spends = txs.filter(isSpend);
  const sum = (rows: { amount: number | null }[]) => round2(rows.reduce((a, r) => a + (r.amount ?? 0), 0));
  const spent = sum(spends);

  const prevSpent = sum(snap.transactions.filter(
    (t) => isSpend(t) && inSpan(t.ts, startOfDay(span.prev.from), endOfDay(span.prev.to)),
  ));

  const byCat = new Map<string, number>();
  for (const t of spends) byCat.set(t.category || 'Other', (byCat.get(t.category || 'Other') ?? 0) + (t.amount ?? 0));
  const categories = [...byCat]
    .map(([key, total]) => ({ key, total: round2(total), share: spent > 0 ? total / spent : 0 }))
    .sort((a, b) => b.total - a.total);

  const days = daysBetween(span.from, span.to) + 1;
  return {
    spent,
    prevSpent,
    count: spends.length,
    days,
    perDay: round2(spent / days),
    billsPaid: sum(txs.filter((t) => t.kind === 'card_payment')),
    lent: sum(txs.filter((t) => t.kind === 'credit_given')),
    saved: sum(txs.filter((t) => t.kind === 'investment')),
    received: sum(snap.income.filter((i) => !i.deleted && inSpan(i.ts, lo, hi))),
    categories,
    entries: txs
      .sort((a, b) => (a.ts! < b.ts! ? 1 : a.ts! > b.ts! ? -1 : 0))
      .map((t) => ({
        id: t.id, ts: t.ts!, day: t.ts!.slice(0, 10), amount: t.amount!, method: t.method,
        category: t.category, remarks: t.remarks, tags: t.userTags, kind: t.kind,
      })),
  };
}
