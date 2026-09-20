'use client';

import { Equal } from 'lucide-react';
import { evaluateAmount, isExpression } from '@/lib/calc';
import { inputClass } from '@/components/ui/field';

/* ===========================================================================
   The amount box, which also adds up.

   One entry is often several figures — three receipts from one shop, a bill
   split four ways, four coffees at sixty. Doing that sum elsewhere and typing
   the answer loses the working, and a typo in a total is invisible forever
   because nothing records what it was meant to be the sum of.

   THE RESULT IS SHOWN BEFORE IT IS SAVED, always. That is what makes it safe
   to be forgiving about what gets typed: a doubled "+" cannot change the
   answer, and anything that genuinely changes it is on screen to be read
   first. A calculator that quietly substituted its own answer would be worse
   than no calculator.

   The expression stays in the box while it is being edited rather than being
   replaced by its total, so a wrong figure can be corrected in place instead
   of retyped from nothing.
   =========================================================================== */

export function AmountField({
  id = 'amount', name = 'amount', value, onChange, error, autoFocus = false, placeholder = '0.00',
}: {
  id?: string;
  name?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const showing = isExpression(value) && value.trim() !== '';
  const result = showing ? evaluateAmount(value) : null;

  return (
    <>
      <input
        id={id}
        name={name}
        inputMode="text"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={showing ? `${id}-calc` : undefined}
        className={`${inputClass(error)} num text-lg`}
      />

      {/* Only once there is arithmetic to report. A running total under every
          plain figure would be noise on the common case. */}
      {showing ? (
        <p
          id={`${id}-calc`}
          aria-live="polite"
          className="mt-1.5 flex items-center gap-1.5 text-xs"
        >
          <Equal className="h-3 w-3 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
          {result?.ok ? (
            <span className="text-[var(--color-ink-2)]">
              <span className="sensitive num font-semibold">
                {result.amount.toLocaleString('en-IN', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span className="text-[var(--color-ink-3)]">
                {' '}from {result.terms} {result.terms === 1 ? 'figure' : 'figures'}
              </span>
            </span>
          ) : (
            <span className="text-[var(--color-warn)]">{message(result?.reason)}</span>
          )}
        </p>
      ) : null}
    </>
  );
}

function message(reason: string | undefined): string {
  switch (reason) {
    case 'divide-by-zero':
      return 'Cannot divide by zero.';
    case 'out-of-range':
      return 'That comes to more than this app will record.';
    case 'too-precise':
      return 'Amounts go to the paisa — two decimal places.';
    default:
      return 'Unfinished sum — check the figures and signs.';
  }
}

/** What a form should submit: the total, or the raw text when it is one figure. */
export function amountToSubmit(value: string): string {
  if (!isExpression(value)) return value;
  const r = evaluateAmount(value);
  // An unreadable expression is passed through untouched so the server's own
  // validation produces the message, rather than this silently sending "".
  return r.ok ? String(r.amount) : value;
}
