import {
  addDays, dayOf, daysBetween, endOfDay, monthEnd, monthKey, monthStart, startOfDay,
  type Day, type Instant,
} from './time.ts';
import type { Snapshot, Transaction } from './types.ts';

/* ===========================================================================
   Spend analytics.

   One definition governs everything here, and it is worth stating plainly:

     SPEND means money consumed. It excludes card bill payments (moving money
     from a bank to a card settles a debt you already counted when you made
     the charge — counting it again double-counts), money lent to other people
     (an outflow, but not consumption), and transfers into savings or
     investments (still your money, just somewhere else).

   Getting this wrong is the classic personal-finance-app bug: a month where
   you paid three card bills looks like a spending disaster.
   =========================================================================== */

/** A transaction that represents real consumption. */
export function isSpend(t: Transaction): boolean {
  return !t.deleted && t.kind === 'spend' && t.amount != null && t.ts != null;
}

/** Rows in [from, to], inclusive, that count as spend. */
export function spendBetween(snapshot: Snapshot, from: Day, to: Day): Transaction[] {
  const lo = startOfDay(from);
  const hi = endOfDay(to);
  return snapshot.transactions.filter((t) => isSpend(t) && t.ts! >= lo && t.ts! <= hi);
}

export function total(rows: Transaction[]): number {
  return round2(rows.reduce((a, t) => a + (t.amount ?? 0), 0));
}

export type Breakdown = {
  key: string;
  total: number;
  count: number;
  share: number;
};

function breakdownBy(rows: Transaction[], pick: (t: Transaction) => string): Breakdown[] {
  const sums = new Map<string, { total: number; count: number }>();
  for (const t of rows) {
    const k = pick(t) || 'Uncategorised';
    const cur = sums.get(k) ?? { total: 0, count: 0 };
    cur.total += t.amount ?? 0;
    cur.count += 1;
    sums.set(k, cur);
  }
  const grand = [...sums.values()].reduce((a, v) => a + v.total, 0);
  return [...sums.entries()]
    .map(([key, v]) => ({
      key,
      total: round2(v.total),
      count: v.count,
      share: grand > 0 ? v.total / grand : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export function byCategory(rows: Transaction[]): Breakdown[] {
  return breakdownBy(rows, (t) => t.category);
}

export function byMethod(rows: Transaction[]): Breakdown[] {
  return breakdownBy(rows, (t) => t.method);
}

export function byTrip(rows: Transaction[]): Breakdown[] {
  return breakdownBy(rows.filter((t) => t.tags.trip), (t) => t.tags.trip ?? '');
}

/** Daily totals across a range, with zero-filled gaps so charts stay honest. */
export function dailySeries(snapshot: Snapshot, from: Day, to: Day): { day: Day; total: number }[] {
  const sums = new Map<Day, number>();
  for (const t of spendBetween(snapshot, from, to)) {
    const d = dayOf(t.ts!);
    sums.set(d, (sums.get(d) ?? 0) + (t.amount ?? 0));
  }
  const out: { day: Day; total: number }[] = [];
  const span = daysBetween(from, to);
  for (let i = 0; i <= span; i++) {
    const d = addDays(from, i);
    out.push({ day: d, total: round2(sums.get(d) ?? 0) });
  }
  return out;
}

/** Monthly totals over the whole history, oldest first. */
export function monthlySeries(snapshot: Snapshot): { month: string; total: number; count: number }[] {
  const sums = new Map<string, { total: number; count: number }>();
  for (const t of snapshot.transactions) {
    if (!isSpend(t)) continue;
    const k = monthKey(t.ts!);
    const cur = sums.get(k) ?? { total: 0, count: 0 };
    cur.total += t.amount ?? 0;
    cur.count += 1;
    sums.set(k, cur);
  }
  return [...sums.entries()]
    .map(([month, v]) => ({ month, total: round2(v.total), count: v.count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function incomeBetween(snapshot: Snapshot, from: Day, to: Day): number {
  const lo = startOfDay(from);
  const hi = endOfDay(to);
  return round2(
    snapshot.income
      .filter((i) => !i.deleted && i.ts && i.amount != null && i.ts >= lo && i.ts <= hi)
      .reduce((a, i) => a + (i.amount ?? 0), 0),
  );
}

export type MonthSummary = {
  month: string;
  from: Day;
  to: Day;
  /** Days elapsed in the month as of `today`, at least 1. */
  elapsed: number;
  daysInMonth: number;
  daysRemaining: number;
  spend: number;
  income: number;
  net: number;
  perDay: number;
  categories: Breakdown[];
  methods: Breakdown[];
};

/** The current month to date, plus the shape needed to project the rest of it. */
export function monthSummary(snapshot: Snapshot, today: Day): MonthSummary {
  const key = monthKey(today);
  const from = monthStart(key);
  const last = monthEnd(key);
  const rows = spendBetween(snapshot, from, today);

  const elapsed = Math.max(1, daysBetween(from, today) + 1);
  const days = daysBetween(from, last) + 1;
  const spend = total(rows);

  return {
    month: key,
    from,
    to: today,
    elapsed,
    daysInMonth: days,
    daysRemaining: Math.max(0, days - elapsed),
    spend,
    income: incomeBetween(snapshot, from, today),
    net: round2(incomeBetween(snapshot, from, today) - spend),
    perDay: round2(spend / elapsed),
    categories: byCategory(rows),
    methods: byMethod(rows),
  };
}

/**
 * The same window one month earlier — same number of days, so a comparison on
 * the 10th compares against the first ten days of last month, not a full month
 * against a partial one.
 */
export function priorWindow(snapshot: Snapshot, today: Day): { spend: number; from: Day; to: Day } {
  const key = monthKey(today);
  const elapsed = daysBetween(monthStart(key), today);
  const prevKey = monthKey(addDays(monthStart(key), -1));
  const from = monthStart(prevKey);
  const to = addDays(from, elapsed);
  return { spend: total(spendBetween(snapshot, from, to)), from, to };
}

export type RecentEntry = {
  id: string;
  ts: Instant;
  day: Day;
  amount: number;
  method: string;
  category: string;
  remarks: string;
  kind: Transaction['kind'];
  verified: boolean;
};

/** Newest activity first, excluding rows dated in the future. */
export function recentActivity(snapshot: Snapshot, today: Day, limit = 8): RecentEntry[] {
  const hi = endOfDay(today);
  return snapshot.transactions
    .filter((t) => !t.deleted && t.ts && t.amount != null && t.ts <= hi)
    .sort((a, b) => (a.ts! < b.ts! ? 1 : a.ts! > b.ts! ? -1 : 0))
    .slice(0, limit)
    .map((t) => ({
      id: t.id,
      ts: t.ts!,
      day: dayOf(t.ts!),
      amount: t.amount!,
      method: t.method,
      category: t.category,
      remarks: t.remarks,
      kind: t.kind,
      verified: t.verified,
    }));
}

/** Pre-logged rows whose date has not arrived yet (EMIs entered in advance). */
export function upcomingRows(snapshot: Snapshot, today: Day): Transaction[] {
  const hi = endOfDay(today);
  return snapshot.transactions
    .filter((t) => !t.deleted && t.ts && t.ts > hi)
    .sort((a, b) => (a.ts! < b.ts! ? -1 : 1));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
