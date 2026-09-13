'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { DayLine } from '@/lib/tally';
import { formatDayShort } from '@/lib/time';
import { Empty, Money, cx } from '@/components/ui/primitives';

/* ===========================================================================
   The statement itself.

   One line per day, newest first, each showing what came in, what went out and
   the balance after it. A day opens to the individual movements behind it —
   which is the part that makes the page useful when a figure disagrees with
   the bank, because the difference is almost always one row.
   =========================================================================== */

export function StatementList({
  days, opening, from,
}: {
  days: DayLine[];
  opening: number;
  from: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (days.length === 0) {
    return <Empty title="Nothing moved in this period" hint="No money came in or went out of these accounts." />;
  }

  return (
    <div className="flex flex-col">
      <div className="hidden items-center gap-x-3 border-b border-[var(--color-line)] px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)] sm:flex">
        <span className="w-6 shrink-0" />
        <span className="min-w-0 flex-1">Date</span>
        <span className="w-28 shrink-0 text-right">In</span>
        <span className="w-28 shrink-0 text-right">Out</span>
        <span className="w-32 shrink-0 text-right">Balance</span>
      </div>

      <ul>
        {days.map((d) => {
          const expanded = open === d.day;
          return (
            <li key={d.day} className="border-b border-[var(--color-line)] last:border-b-0">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : d.day)}
                aria-expanded={expanded}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-raised)]"
              >
                <ChevronRight
                  className={cx(
                    'h-3.5 w-3.5 shrink-0 text-[var(--color-ink-3)] transition-transform',
                    expanded && 'rotate-90',
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {formatDayShort(d.day)}
                  <span className="ml-2 text-xs font-normal text-[var(--color-ink-3)]">
                    {d.movements.length} {d.movements.length === 1 ? 'movement' : 'movements'}
                  </span>
                </span>

                <span className="w-28 shrink-0 text-right">
                  {d.in > 0 ? <Money value={d.in} size="sm" tone="credit" /> : <span className="text-xs text-[var(--color-ink-3)]">&mdash;</span>}
                </span>
                <span className="w-28 shrink-0 text-right">
                  {d.out > 0 ? <Money value={d.out} size="sm" tone="debt" /> : <span className="text-xs text-[var(--color-ink-3)]">&mdash;</span>}
                </span>
                <span className="w-32 shrink-0 text-right">
                  <Money value={d.balance} size="sm" className="font-semibold" />
                </span>
              </button>

              {expanded ? (
                <ul className="border-t border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-1.5">
                  {d.movements.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 py-1.5 text-xs">
                      <span className="num w-12 shrink-0 text-[var(--color-ink-3)]">
                        {m.ts.slice(11, 16)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{m.label}</span>
                      <span className="w-20 shrink-0 truncate text-[var(--color-ink-3)]">
                        {m.counterparty}
                      </span>
                      <span className="w-28 shrink-0 text-right">
                        <Money
                          value={m.amount}
                          size="sm"
                          tone={m.direction === 'in' ? 'credit' : 'debt'}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Where the running balance started, so the first line has something to
          be a balance relative to. */}
      <div className="flex items-center gap-x-3 border-t border-[var(--color-line)] px-3 py-2.5 text-xs text-[var(--color-ink-3)]">
        <span className="w-6 shrink-0" />
        <span className="min-w-0 flex-1">Balance carried into {formatDayShort(from)}</span>
        <span className="hidden w-28 shrink-0 sm:block" />
        <span className="hidden w-28 shrink-0 sm:block" />
        <span className="w-32 shrink-0 text-right">
          <Money value={opening} size="sm" tone="muted" />
        </span>
      </div>
    </div>
  );
}
