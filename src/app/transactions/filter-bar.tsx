'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { ALL_METHODS, CARD_NAMES, SPEND_CATEGORIES, TRANSFER_CATEGORIES } from '@/lib/types';
import { formatDay, formatMonth } from '@/lib/time';
import { money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/field';
import { cn } from '@/lib/cn';

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
  tag: string[];
  from: string;
  to: string;
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
  months, tags, initial, narrowed, matched, total, spend,
}: {
  months: string[];
  /** Tags in use, most used first. */
  tags: string[];
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
  const [custom, setCustom] = useState(false);
  // One "When": a month, or a range (an exact day is a range of one).
  const when = custom || initial.from || initial.to || initial.day ? 'custom' : initial.month;
  const compact = cn(inputClass(), 'h-8 px-2 py-0 text-xs');

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
  for (const t of initial.tag) {
    chips.push({ key: `tag-${t}`, label: <># {t}</>, clear: { tag: without(initial.tag, t) } });
  }
  if (initial.from || initial.to) {
    chips.push({
      key: 'range',
      label: `${initial.from ? formatDay(initial.from) : 'start'} – ${initial.to ? formatDay(initial.to) : 'today'}`,
      clear: { from: undefined, to: undefined },
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
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
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
              type="search"
              enterKeyHint="search"
              placeholder="Search entries"
              aria-label="Search transactions — press Enter"
              className={cn(inputClass(), 'h-9 py-1 pl-9')}
            />
          </div>
        </form>

        <Button
          type="button"
          size="sm"
          variant={narrowed || open ? 'secondary' : 'ghost'}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Filters"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Filters</span>
          {chips.length ? <span className="num text-xs">{chips.length}</span> : null}
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
            onClick={() => set({ q: undefined, month: undefined, day: undefined, cat: undefined, method: undefined, tag: undefined, from: undefined, to: undefined, min: undefined, max: undefined })}
            className="px-1.5 text-[11px] font-medium text-[var(--color-accent)]"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {/* Compact by design: three rows on a phone. Each select names its
          own "any" state, so the controls need no labels above them; a month,
          an exact day and a range are one "When", since they are one question. */}
      {open ? (
        <div className="grid grid-cols-2 gap-2 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-2">
          <div className="col-span-2 grid gap-2">
            <select
              aria-label="When"
              value={when}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'custom') { setCustom(true); return; }
                setCustom(false);
                set({ month: v || undefined, day: undefined, from: undefined, to: undefined });
              }}
              className={compact}
            >
              <option value="">Any time</option>
              <option value="custom">Custom dates…</option>
              <optgroup label="Month">
                {months.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
              </optgroup>
            </select>
            {when === 'custom' ? (
              <span className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
                <input
                  type="date"
                  aria-label="From"
                  value={initial.from || initial.day}
                  onChange={(e) => set({ from: e.target.value || undefined, to: initial.to || initial.day || undefined, day: undefined, month: undefined })}
                  className={cn(compact, 'min-w-0')}
                />
                <span className="text-xs text-[var(--color-ink-3)]">–</span>
                <input
                  type="date"
                  aria-label="To"
                  value={initial.to || initial.day}
                  onChange={(e) => set({ to: e.target.value || undefined, from: initial.from || initial.day || undefined, day: undefined, month: undefined })}
                  className={cn(compact, 'min-w-0')}
                />
              </span>
            ) : null}
          </div>

          {/* Choose several. The select ADDS and the chips REMOVE, rather than
              a multi-select box: twenty-two categories will not fit as a wall
              of chips, and a native multiple-select is close to unusable on a
              phone. Several chosen means ANY of them. */}
          <select
            aria-label="Category"
            value=""
            onChange={(e) => e.target.value && set({ cat: withValue(initial.category, e.target.value) })}
            className={compact}
          >
            <option value="">{initial.category.length > 0 ? '+ Category' : 'Any category'}</option>
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

          <select
            aria-label="Paid with"
            value=""
            onChange={(e) => e.target.value && set({ method: withValue(initial.method, e.target.value) })}
            className={compact}
          >
            <option value="">{initial.method.length > 0 ? '+ Paid with' : 'Any payment'}</option>
            {ALL_METHODS.filter((m) => !initial.method.includes(m))
              .map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          <select
            aria-label="Tag"
            value=""
            onChange={(e) => e.target.value && set({ tag: withValue(initial.tag, e.target.value) })}
            className={compact}
            disabled={tags.length === 0}
          >
            <option value="">
              {tags.length === 0 ? 'No tags yet' : initial.tag.length > 0 ? '+ Tag' : 'Any tag'}
            </option>
            {tags.filter((t) => !initial.tag.includes(t)).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <span className="flex min-w-0 items-center gap-1">
            <input
              aria-label="At least"
              defaultValue={initial.min ?? ''}
              onBlur={(e) => set({ min: e.target.value.trim() || undefined })}
              inputMode="decimal"
              placeholder="Min ₹"
              className={cn(compact, 'num min-w-0')}
            />
            <span className="text-xs text-[var(--color-ink-3)]">–</span>
            <input
              aria-label="At most"
              defaultValue={initial.max ?? ''}
              onBlur={(e) => set({ max: e.target.value.trim() || undefined })}
              inputMode="decimal"
              placeholder="Max ₹"
              className={cn(compact, 'num min-w-0')}
            />
          </span>
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
