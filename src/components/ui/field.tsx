import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/* A labelled form control with its error message. One component owns the
   wiring — label association, aria-invalid, aria-describedby — so no field can
   ship an error a screen reader never announces. */

export function Field({
  label, htmlFor, error, hint, children, className,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-[var(--color-ink-2)]">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={hintId} className="text-[11px] text-[var(--color-ink-3)]">{hint}</p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-[11px] font-medium text-[var(--color-neg)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const control =
  'w-full rounded-[var(--radius-field)] border bg-[var(--color-canvas)] px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-50';

export function inputClass(error?: string) {
  return cn(control, error ? 'border-[var(--color-neg)]' : 'border-[var(--color-line)]');
}
