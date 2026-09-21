'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/* Radix handles focus trapping, focus restore, escape, scroll lock and the
   aria wiring. Hand-rolling a modal means getting all of that wrong, and a
   form that loses focus is a form that loses an entry. */

export function Dialog({
  open, onOpenChange, title, description, children, footer, wide, onEscapeKeyDown,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /**
   * Radix's own escape hook, forwarded.
   *
   * A popover INSIDE the dialog — the remarks suggestion list — needs Escape
   * to close itself and not the dialog behind it. It cannot do that from
   * where it sits: Radix listens on `document` in the CAPTURE phase, so the
   * dialog has already decided before any descendant's handler runs. Calling
   * preventDefault here is the only place that decision can be changed.
   */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <RadixDialog.Content
          onEscapeKeyDown={onEscapeKeyDown}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-pop)]',
            wide ? 'max-w-2xl' : 'max-w-md',
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <RadixDialog.Title className="text-base font-semibold tracking-tight">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-xs text-[var(--color-ink-3)]">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--color-ink-3)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
              aria-label="Close"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </RadixDialog.Close>
          </div>

          {children}

          {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
