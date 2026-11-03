import { round2 } from '@/lib/money';
import { foldForSearch } from '@/lib/search-text';
import type { TxKind } from '@/lib/types';

/* ===========================================================================
   Categories, taken apart on demand.

   The ranked bars on a card's analysis say which category is biggest. The
   next questions are always the same ones — how many times, how much each
   time, which entries, and is it the same if lending is counted too — and
   each needs the rows themselves, not a total. This groups a plain list of
   charges by category and sorts it any way asked; the page does the rest in
   the browser, so a change of sort or filter costs no request.

   Pure. The rows come from the page; nothing here reads a clock.
   =========================================================================== */

/** The part of a charge the explorer needs — small enough to send to the browser. */
export type ExploreRow = {
  id: string;
  ts: string;
  amount: number;
  category: string;
  remarks: string;
  tags: string[];
  kind: TxKind;
};

export type ExploreScope = 'spend' | 'all' | 'lent';
/**
 * How the explorer is ordered. ONE choice orders BOTH levels — the categories,
 * and the entries inside an opened category — because a sort that reorders the
 * list but leaves the rows underneath in a different order reads as broken.
 * Entries stay grouped by day either way (every list of entries in this app
 * is); the sort decides the order of the days and of the rows within each.
 */
export type ExploreSort = 'total' | 'count' | 'average' | 'name' | 'newest' | 'oldest';

export type CategoryGroup = {
  category: string;
  total: number;
  count: number;
  average: number;
  largest: number;
  /** The most recent and the oldest entry, so categories can be ordered by when. */
  latest: string;
  earliest: string;
  /** Of the filtered total, 0..1. */
  share: number;
  /** Newest first. */
  rows: ExploreRow[];
};

export function inScope(row: ExploreRow, scope: ExploreScope): boolean {
  if (scope === 'all') return true;
  if (scope === 'lent') return row.kind === 'credit_given';
  return row.kind === 'spend';
}

/** Every word typed must appear in the remarks or the category. */
export function matchesQuery(row: ExploreRow, query: string): boolean {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = foldForSearch(`${row.remarks} ${row.category} ${row.tags.join(' ')}`);
  return words.every((w) => hay.includes(w));
}

export function exploreCategories(
  rows: ExploreRow[],
  opts: { scope: ExploreScope; sort: ExploreSort; query?: string },
): { groups: CategoryGroup[]; total: number; count: number } {
  const kept = rows.filter((r) => inScope(r, opts.scope) && matchesQuery(r, opts.query ?? ''));

  const by = new Map<string, ExploreRow[]>();
  for (const r of kept) {
    const key = r.category || 'Uncategorised';
    const list = by.get(key);
    if (list) list.push(r);
    else by.set(key, [r]);
  }

  // Summed in paise so a group's total always equals the sum of its rows.
  const paise = (n: number) => Math.round(n * 100);
  const totalPaise = kept.reduce((a, r) => a + paise(r.amount), 0);

  const groups: CategoryGroup[] = [...by.entries()].map(([category, list]) => {
    const p = list.reduce((a, r) => a + paise(r.amount), 0);
    return {
      category,
      total: p / 100,
      count: list.length,
      average: round2(p / 100 / list.length),
      largest: Math.max(...list.map((r) => r.amount)),
      latest: list.reduce((m, r) => (r.ts > m ? r.ts : m), ''),
      earliest: list.reduce((m, r) => (m === '' || r.ts < m ? r.ts : m), ''),
      share: totalPaise > 0 ? p / totalPaise : 0,
      rows: [...list].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)),
    };
  });

  const byName = (a: CategoryGroup, b: CategoryGroup) => a.category.localeCompare(b.category);
  const cmp: Record<ExploreSort, (a: CategoryGroup, b: CategoryGroup) => number> = {
    total: (a, b) => b.total - a.total || byName(a, b),
    count: (a, b) => b.count - a.count || b.total - a.total || byName(a, b),
    average: (a, b) => b.average - a.average || byName(a, b),
    name: byName,
    newest: (a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : byName(a, b)),
    oldest: (a, b) => (a.earliest < b.earliest ? -1 : a.earliest > b.earliest ? 1 : byName(a, b)),
  };
  groups.sort(cmp[opts.sort]);

  return { groups, total: totalPaise / 100, count: kept.length };
}

/**
 * Rows grouped by day, ordered by the chosen sort.
 *
 *   total, average  the biggest day first, and the biggest amount first inside it
 *   count           the day with the most entries first
 *   name            newest day first, A–Z by description inside each
 *   newest, oldest  by date, in that direction, rows by time the same way
 *
 * Ties fall back to the newest day, so the order is always the same one.
 */
export function byDay(
  rows: ExploreRow[],
  sort: ExploreSort = 'newest',
): { day: string; total: number; rows: ExploreRow[] }[] {
  const days = new Map<string, ExploreRow[]>();
  for (const r of rows) {
    const d = r.ts.slice(0, 10);
    const list = days.get(d);
    if (list) list.push(r);
    else days.set(d, [r]);
  }

  const newestTs = (a: ExploreRow, b: ExploreRow) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0);
  const label = (r: ExploreRow) => foldForSearch(r.remarks || r.category);
  const inDay: Record<ExploreSort, (a: ExploreRow, b: ExploreRow) => number> = {
    total: (a, b) => b.amount - a.amount || newestTs(a, b),
    average: (a, b) => b.amount - a.amount || newestTs(a, b),
    count: newestTs,
    name: (a, b) => label(a).localeCompare(label(b)) || newestTs(a, b),
    newest: newestTs,
    oldest: (a, b) => -newestTs(a, b),
  };

  const groups = [...days.entries()].map(([day, list]) => ({
    day,
    total: list.reduce((a, r) => a + Math.round(r.amount * 100), 0) / 100,
    rows: [...list].sort(inDay[sort]),
  }));

  const newestDay = (a: { day: string }, b: { day: string }) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0);
  const order: Record<ExploreSort, (a: (typeof groups)[number], b: (typeof groups)[number]) => number> = {
    total: (a, b) => b.total - a.total || newestDay(a, b),
    average: (a, b) => b.total - a.total || newestDay(a, b),
    count: (a, b) => b.rows.length - a.rows.length || newestDay(a, b),
    name: newestDay,
    newest: newestDay,
    oldest: (a, b) => -newestDay(a, b),
  };
  return groups.sort(order[sort]);
}
