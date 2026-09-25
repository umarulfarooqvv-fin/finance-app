'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Panel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/* ===========================================================================
   A panel whose body can be folded away, remembered per device.

   For REFERENCE, not data: the Shortcut recipes, the import prompt — things
   read once while setting something up and then scrolled past on every visit
   after. They start folded, one tap opens them, and whichever way a person
   leaves one is how it stays on this device.

   Never used for anything holding money. A balance that can be folded away is
   a balance that can be missed, and "I thought it was fine, the panel was
   shut" is not a failure mode this app gets to have.

   The remembered state is a per-device convenience, so localStorage is the
   right home and a failure to read it simply shows the default.
   =========================================================================== */

const storageKey = (id: string) => `pfm:section:${id}`;

export function CollapsiblePanel({
  id, title, action, defaultOpen = false, className, children,
}: {
  /** Stable name for remembering this panel's state. */
  id: string;
  title: ReactNode;
  /** Stays visible and usable while folded — a Copy button, a link. */
  action?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  // Read after mount: the server cannot know, and rendering the default first
  // keeps the server's HTML and the first client render identical.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey(id));
      if (saved === 'open' || saved === 'closed') setOpen(saved === 'open');
    } catch { /* private browsing: the default stands */ }
  }, [id]);

  function toggle() {
    setOpen((was) => {
      const next = !was;
      try { localStorage.setItem(storageKey(id), next ? 'open' : 'closed'); } catch { /* ignore */ }
      return next;
    });
  }

  return (
    <Panel className={className}>
      <div className={cn('flex items-center justify-between gap-3', open && 'mb-3')}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="group -mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left"
        >
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-[var(--color-ink-3)] transition-transform',
              !open && '-rotate-90',
            )}
            aria-hidden="true"
          />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)] group-hover:text-[var(--color-ink-2)]">
            {title}
          </h2>
          {!open ? (
            <span className="ml-1 text-[10px] normal-case tracking-normal text-[var(--color-ink-3)]">
              · tap to show
            </span>
          ) : null}
        </button>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </Panel>
  );
}
