'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CalendarRange, Check } from 'lucide-react';
import { formatMonth } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/field';
import { cx } from '@/components/ui/primitives';
import { DAY_PRESETS, periodHref, presetLabel, type Period } from './period';

/* ===========================================================================
   Choosing the stretch of time the page describes.

   The quick choices sit on one row because they answer almost every question
   on their own. A month, a year and an exact range are one tap further in,
   where they do not crowd the common case.

   Like every other filter in this app the selection lives in the URL, so a
   period can be reloaded, shared, and stepped back out of.
   =========================================================================== */

export function PeriodPicker({
  period, months, years,
}: {
  period: Period;
  /** Months and years the data actually covers, newest first. */
  months: string[];
  years: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(period.kind === 'range' ? period.from : '');
  const [to, setTo] = useState(period.kind === 'range' ? period.to : '');

  const go = (over: Record<string, string | undefined>) => router.push(periodHref(over));

  const quick: { key: string; label: string; active: boolean; href: Record<string, string | undefined> }[] = [
    { key: 'mtd', label: 'This month', active: period.kind === 'mtd', href: {} },
    ...DAY_PRESETS.map((n) => ({
      key: `d${n}`,
      label: presetLabel(n),
      active: period.kind === 'days' && period.days === n,
      href: { p: 'days', n: String(n) },
    })),
    { key: 'ytd', label: 'This year', active: period.kind === 'ytd', href: { p: 'ytd' } },
    { key: 'all', label: 'All time', active: period.kind === 'all', href: { p: 'all' } },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {quick.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => go(c.href)}
            aria-pressed={c.active}
            className={cx(
              'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              c.active
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)]',
            )}
          >
            {c.active ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
            {c.label}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            period.kind === 'month' || period.kind === 'year' || period.kind === 'range'
              ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
              : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)]',
          )}
        >
          <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
          {period.kind === 'month' || period.kind === 'year' || period.kind === 'range'
            ? period.label
            : 'Pick a period'}
        </button>
      </div>

      {open ? (
        <div className="grid gap-3 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">A month</span>
            <select
              value={period.kind === 'month' ? monthValue(period) : ''}
              onChange={(e) => e.target.value && go({ p: 'month', m: e.target.value })}
              className={inputClass()}
            >
              <option value="">Choose…</option>
              {months.map((m) => (
                <option key={m} value={m}>{formatMonth(m)}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">A year</span>
            <select
              value={period.kind === 'year' ? period.from.slice(0, 4) : ''}
              onChange={(e) => e.target.value && go({ p: 'year', y: e.target.value })}
              className={inputClass()}
            >
              <option value="">Choose…</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass()} />
          </label>

          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[11px] font-medium text-[var(--color-ink-3)]">To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass()} />
            </label>
            <Button
              type="button"
              size="sm"
              className="mb-[1px]"
              disabled={!from || !to}
              onClick={() => go({ p: 'range', from, to })}
            >
              Apply
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A month period's own key, which is just its first day without the day part. */
function monthValue(period: Period): string {
  return period.from.slice(0, 7);
}
