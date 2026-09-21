'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { ALL_METHODS, CARD_NAMES, SPEND_CATEGORIES, TRANSFER_CATEGORIES } from '@/lib/types';
import { formatDay, formatMonth } from '@/lib/time';
import { money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/field';
import { cx } from '@/components/ui/primitives';

/* ===========================================================================
   Narrowing the list.

   Every control writes to the URL and nothing else. Reloading, sharing the
   link, or pressing Back all land on exactly the view you were looking at,
   and the server does the filtering over the full ledger rather than the
   client filtering one page of it - a filter that only searched the rows
   already on screen would quietly lie about what it found.

   The panel is collapsed by default on a phone. It opens already showing what
   is active, so the answer to "why am I only seeing four rows?" is one tap
   away and never a mystery.
   =========================================================================== */

export type InitialFilters = {
  q?: string;
  month: string;
  day: string;
  category: string[];
  method: string[];
  min?: string;
  max?: string;
  upcoming: boolean;
  deleted: boolean;
};

/* A card name is a valid CATEGORY - it means that card's bill was paid - and
   also a valid METHOD. Same word, opposite direction. The menu groups them
   under a heading that says which one is meant, so "Coral" never sits next to
   "Food" with nothing to tell them apart.

   TRANSFER_CATEGORIES carries the legacy spellings ("Credit Card",
   "Investment", "Savings") that older rows still use; they are offered
   because filtering has to be able to reach rows that exist. */

/** The param value for a list, or undefined so the key leaves the URL. */
const asParam = (values: string[]): string | undefined =>
  values.length > 0 ? values.join(',') : undefined;

const withValue = (values: string[], add: string): string | undefined =>
  asParam([...new Set([...values, add])]);

const without = (values: string[], drop: string): string | undefined =>
  asParam(values.filter((v) => v !== drop));

export function FilterBar({
  months, initial, narrowed, matched, total, spend,
}: {
  months: string[];
  initial: InitialFilters;
  narrowed: boolean;
  matched: number;
  total: number;
  spend: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(initial.q ?? '');

  /** One writer for the URL, so no control can forget to reset the page. */
  function set(over: Record<string, string | undefined>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries({ page: undefined, ...over })) {
      if (v === undefined || v === '') p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    router.push(s ? `/transactions?${s}` : '/transactions');
  }

  /* An amount bound is still a figure on screen, so it goes through the same
     blur as every other one rather than being special-cased. The label is a
     node, not a string, so the guard can wrap just the number. */
  /* `clear` is what the chip's X applies. It is not always "remove the key":
     dropping one of several categories leaves the others, so the value can be
     a shorter list rather than undefined. */
  const chips: { key: string; label: ReactNode; clear: Record<string, string | undefined> }[] = [];
  if (initial.q) chips.push({ key: 'q', label: `“${initial.q}”`, clear: { q: undefined } });
  if (initial.day) chips.push({ key: 'day', label: formatDay(initial.day), clear: { day: undefined } });
  else if (initial.month) chips.push({ key: 'month', label: formatMonth(initial.month), clear: { month: undefined } });
  /* One chip per chosen value, each removable on its own — a single chip
     saying "3 categories" would make removing one of them impossible without
     opening the panel again. */
  for (const c of initial.category) {
    chips.push({
      key: `cat-${c}`,
      label: c,
      clear: { cat: without(initial.category, c) },
    });
  }
  for (const m of initial.method) {
    chips.push({
      key: `method-${m}`,
      label: `from ${m}`,
      clear: { method: without(initial.method, m) },
    });
  }
  if (initial.min) {
    chips.push({
      key: 'min',
      label: <>&ge; <span className="sensitive num">{money(Number(initial.min))}</span></>,
      clear: { min: undefined },
    });
  }
  if (initial.max) {
    chips.push({
      key: 'max',
      label: <>&le; <span className="sensitive num">{money(Number(initial.max))}</span></>,
      clear: { max: undefined },
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => { e.preventDefault(); set({ q }); }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-3)]"
              aria-hidden="true"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search remarks, category, method or amount"
              aria-label="Search transactions"
              className={cx(inputClass(), 'pl-9')}
            />
          </div>
          <Button type="submit" size="sm">Search</Button>
        </form>

        <Button
          type="button"
          size="sm"
          variant={narrowed ? 'secondary' : 'ghost'}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filters{chips.length ? ` · ${chips.length}` : ''}
        </Button>
      </div>

      {/* Active filters stay visible whether or not the panel is open: the
          list is narrowed, and that must never be invisible state. */}
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => set(c.clear)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-raised)] py-1 pl-2.5 pr-1.5 text-[11px] font-medium text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-line-strong)]"
            >
              {c.label}
              <X className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => set({ q: undefined, month: undefined, day: undefined, cat: undefined, method: undefined, min: undefined, max: undefined })}
            className="px-1.5 text-[11px] font-medium text-[var(--color-accent)]"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="grid gap-3 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">Month</span>
            <select
              value={initial.month}
              onChange={(e) => set({ month: e.target.value || undefined, day: undefined })}
              className={inputClass()}
            >
              <option value="">Any month</option>
              {months.map((m) => (
                <option key={m} value={m}>{formatMonth(m)}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">Exact day</span>
            <input
              type="date"
              value={initial.day}
              onChange={(e) => set({ day: e.target.value || undefined, month: undefined })}
              className={inputClass()}
            />
          </label>

          {/* Choose several. The select ADDS and the chips REMOVE, rather than
              a multi-select box: twenty-two categories will not fit as a wall
              of chips, and a native multiple-select is close to unusable on a
              phone. Several chosen means ANY of them. */}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">
              Category{initial.category.length > 0 ? ` · ${initial.category.length}` : ''}
            </span>
            <select
              value=""
              onChange={(e) => e.target.value && set({ cat: withValue(initial.category, e.target.value) })}
              className={inputClass()}
            >
              <option value="">{initial.category.length > 0 ? 'Add another…' : 'Any category'}</option>
              <optgroup label="Spending">
                {SPEND_CATEGORIES.filter((c) => !initial.category.includes(c))
                  .map((c) => <option key={c} value={c}>{c}</option>)}
              </optgroup>
              <optgroup label="Bill paid to a card">
                {CARD_NAMES.filter((c) => !initial.category.includes(c))
                  .map((c) => <option key={c} value={c}>{c}</option>)}
              </optgroup>
              <optgroup label="Transfers">
                {TRANSFER_CATEGORIES.filter((c) => !initial.category.includes(c))
                  .map((c) => <option key={c} value={c}>{c}</option>)}
              </optgroup>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">
              Paid with{initial.method.length > 0 ? ` · ${initial.method.length}` : ''}
            </span>
            <select
              value=""
              onChange={(e) => e.target.value && set({ method: withValue(initial.method, e.target.value) })}
              className={inputClass()}
            >
              <option value="">{initial.method.length > 0 ? 'Add another…' : 'Any method'}</option>
              {ALL_METHODS.filter((m) => !initial.method.includes(m))
                .map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">At least</span>
            <input
              defaultValue={initial.min ?? ''}
              onBlur={(e) => set({ min: e.target.value.trim() || undefined })}
              inputMode="decimal"
              placeholder="0"
              className={cx(inputClass(), 'num')}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">At most</span>
            <input
              defaultValue={initial.max ?? ''}
              onBlur={(e) => set({ max: e.target.value.trim() || undefined })}
              inputMode="decimal"
              placeholder="No limit"
              className={cx(inputClass(), 'num')}
            />
          </label>
        </div>
      ) : null}

      {/* What the current selection actually adds up to. Both figures, because
          they answer different questions and only one of them is "spending". */}
      {narrowed ? (
        <p className="text-xs text-[var(--color-ink-2)]">
          {matched.toLocaleString('en-IN')} {matched === 1 ? 'entry' : 'entries'} ·{' '}
          <span className="sensitive num font-semibold">{money(spend)}</span> spent
          {Math.abs(total - spend) > 0.005 ? (
            <>
              {' '}·{' '}
              <span className="sensitive num">{money(total)}</span> moved in total
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
