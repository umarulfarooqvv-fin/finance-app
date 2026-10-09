'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { Money, SectionTitle, cx } from '@/components/ui/primitives';
import { inputClass } from '@/components/ui/field';
import { EditEntryButton } from '@/components/entry/entry-editor';
import { TagChips } from '@/components/entry/tag-input';
import { formatDayShort } from '@/lib/time';
import {
  byDay, exploreCategories,
  type ExploreRow, type ExploreScope, type ExploreSort,
} from '@/lib/category-explore';

/* ===========================================================================
   Spending by category, with the questions that come after the bars:
   counted how, ordered how, and which entries made it.

   Everything is computed in the browser from the charges the page already
   has, so switching a sort or typing in the search is instant. A category
   opens into its entries grouped by day — the app's rule for any list of
   entries.
   =========================================================================== */

const SCOPES: { key: ExploreScope; label: string; note: string }[] = [
  {
    key: 'spend',
    label: 'Spending',
    note: 'Consumption only. Lending, bill payments and transfers into savings are left out — counting them is what makes a month with three bill payments look like a disaster.',
  },
  { key: 'all', label: 'All charges', note: 'Everything charged to the card, whatever it was for.' },
  { key: 'lent', label: 'Lent', note: 'Only money charged to the card on someone else’s behalf.' },
];

const SORTS: { key: ExploreSort; label: string }[] = [
  { key: 'total', label: 'Highest total' },
  { key: 'count', label: 'Most entries' },
  { key: 'average', label: 'Biggest average' },
  { key: 'name', label: 'A–Z' },
];

const chip = (active: boolean) =>
  cx(
    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
    active
      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
      : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)]',
  );

export function CategoryExplorer({ rows }: { rows: ExploreRow[] }) {
  const [scope, setScope] = useState<ExploreScope>('spend');
  const [sort, setSort] = useState<ExploreSort>('total');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const { groups, total, count } = useMemo(
    () => exploreCategories(rows, { scope, sort, query }),
    [rows, scope, sort, query],
  );
  const max = Math.max(0, ...groups.map((g) => (sort === 'count' ? g.count : sort === 'average' ? g.average : g.total)));
  const measure = (g: (typeof groups)[number]) =>
    sort === 'count' ? g.count : sort === 'average' ? g.average : g.total;

  return (
    <>
      <SectionTitle>By category &middot; {groups.length}</SectionTitle>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {SCOPES.map((s) => (
          <button key={s.key} type="button" className={chip(scope === s.key)} onClick={() => setScope(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-[var(--color-ink-2)]">{SCOPES.find((s) => s.key === scope)!.note}</p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-48">
          <span className="sr-only">Filter by description or category</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-ink-3)]" aria-hidden="true" />
          <input
            type="text"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter — e.g. petrol, swiggy"
            className={cx(inputClass(), 'pl-8 pr-8')}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear the filter"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-3)]">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as ExploreSort)}
            className={cx(inputClass(), 'w-auto py-1.5')}
          >
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--color-ink-3)]">
        <span>{count} {count === 1 ? 'entry' : 'entries'}{query ? ' match' : ''}</span>
        <span>Total <Money value={total} size="sm" className="font-semibold text-[var(--color-ink)]" /></span>
      </div>

      {groups.length === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--color-ink-3)]">
          {query ? 'Nothing matches that filter.' : 'Nothing in this period.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {groups.map((g) => {
            const isOpen = open === g.category;
            return (
              <li key={g.category} className="border-b border-[var(--color-line)] last:border-b-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : g.category)}
                  className="flex w-full flex-col gap-1.5 py-2.5 text-left"
                >
                  <span className="flex w-full items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm">{g.category}</span>
                    <Money value={g.total} size="sm" className="font-semibold" />
                    <span className="num w-10 shrink-0 text-right text-[11px] text-[var(--color-ink-3)]">
                      {(g.share * 100).toFixed(0)}%
                    </span>
                    <ChevronDown
                      className={cx('h-3.5 w-3.5 shrink-0 text-[var(--color-ink-3)] transition-transform', isOpen && 'rotate-180')}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-raised)]">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)]"
                      style={{ width: `${max > 0 ? Math.max(1.5, (measure(g) / max) * 100) : 0}%` }}
                    />
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-[11px] text-[var(--color-ink-3)]">
                    <span>{g.count} {g.count === 1 ? 'entry' : 'entries'}</span>
                    <span>avg <Money value={g.average} size="sm" /></span>
                    <span>biggest <Money value={g.largest} size="sm" /></span>
                  </span>
                </button>

                {isOpen ? (
                  <div className="mb-3 overflow-hidden rounded-[var(--radius-field)] border border-[var(--color-line)]">
                    {byDay(g.rows).map((d) => (
                      <div key={d.day}>
                        <div className="flex items-center justify-between bg-[var(--color-canvas)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-ink-3)]">
                          <span>{formatDayShort(d.day)}</span>
                          <Money value={d.total} size="sm" />
                        </div>
                        {d.rows.map((r) => (
                          <div
                            key={r.id}
                            className="flex items-center gap-3 border-t border-[var(--color-line)] px-3 py-2 text-xs"
                          >
                            <span className="num w-10 shrink-0 text-[var(--color-ink-3)]">{r.ts.slice(11, 16)}</span>
                            <span className="min-w-0 flex-1 truncate">{r.remarks || g.category}</span>
                            <TagChips tags={r.tags} />
                            <Money value={r.amount} size="sm" tone="debt" />
                            <EditEntryButton id={r.id} label={`Edit ${r.remarks || g.category}`} className="-my-1" />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
