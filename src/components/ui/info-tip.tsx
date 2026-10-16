'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cx } from '@/components/ui/primitives';

/* ===========================================================================
   An explanation on request: a small ⓘ beside a label, and the text in a
   bubble when it is tapped. Help a person needs once should not take room on
   the screen every time after.

   Tap again, tap elsewhere or press Esc to close. A button, so it works by
   keyboard and is announced to a screen reader with the text it controls.
   =========================================================================== */

export function InfoTip({ children, label = 'What is this?', className }: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Which way the bubble hangs: centred, unless that would run off the screen.
  const [side, setSide] = useState<'center' | 'left' | 'right'>('center');
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <span ref={box} className={cx('relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const mid = r.left + r.width / 2;
          const half = 120; // half the bubble's width, and a little margin
          setSide(mid - half < 8 ? 'left' : mid + half > window.innerWidth - 8 ? 'right' : 'center');
          setOpen((o) => !o);
        }}
        className={cx(
          'grid h-5 w-5 place-items-center rounded-full transition-colors',
          open ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]',
        )}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cx(
            'absolute top-full z-30 mt-1 w-56 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-left text-xs normal-case leading-snug tracking-normal text-[var(--color-ink-2)] shadow-[var(--shadow-pop)]',
            side === 'center' && 'left-1/2 -translate-x-1/2',
            side === 'left' && '-left-2',
            side === 'right' && '-right-2',
          )}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
