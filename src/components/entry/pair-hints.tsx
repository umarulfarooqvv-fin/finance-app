'use client';

import { Sparkles } from 'lucide-react';
import type { EntryPair } from '@/lib/entry-hints';
import { cx } from '@/components/ui/primitives';

/* ===========================================================================
   One tap for both dropdowns.

   Nearly every entry here repeats one that came before it — breakfast on Fi
   under Food, a shop bill on Scapia under Family — so choosing both from
   scratch each time types out an answer the history already holds.

   THEY ARE TAPPED, NOT PRE-SELECTED. The voice parser in this app refuses to
   fill a payment method it is not certain of, because a wrong method moves
   debt onto the wrong card and nothing afterwards looks wrong. A dropdown
   that arrives pre-filled is indistinguishable from one that was chosen, the
   moment the dialog is saved — so these stay inert until touched.

   A pairing already matching the form is shown as selected rather than
   hidden: seeing that the current choice IS the usual one is worth as much as
   being offered a change.
   =========================================================================== */

export function PairHints({
  pairs, method, category, onPick, note,
}: {
  pairs: EntryPair[];
  method: string;
  category: string;
  onPick: (pair: { method: string; category: string }) => void;
  /** Why these are being shown, when it is not simply "used most". */
  note?: string;
}) {
  if (pairs.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Sparkles className="h-3 w-3 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
      <span className="mr-0.5 text-[11px] text-[var(--color-ink-3)]">
        {note ?? 'Used most'}
      </span>
      {pairs.map((p) => {
        const active = p.method === method && p.category === category;
        return (
          <button
            key={`${p.method}-${p.category}`}
            type="button"
            tabIndex={-1}
            aria-pressed={active}
            title={`${p.count} ${p.count === 1 ? 'entry' : 'entries'}, most recently ${p.lastOn}`}
            onClick={() => onPick({ method: p.method, category: p.category })}
            className={cx(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              active
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-raised)]',
            )}
          >
            {p.method} · {p.category}
          </button>
        );
      })}
    </div>
  );
}
