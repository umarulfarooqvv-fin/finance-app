'use client';

import { useEffect, useRef } from 'react';
import { Equal } from 'lucide-react';
import { evaluateAmount, insertOperator, isExpression } from '@/lib/calc';
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

   THE OPERATORS ARE BUTTONS because a phone showing a numeric keypad has no
   way to type them. Reaching + or × means switching to the letter keyboard
   and back for every term, which is enough friction to make the feature not
   worth using — so the keypad stays numeric and the four symbols sit under
   the box.
   =========================================================================== */

const OPERATORS = [
  { op: '+', label: 'add' },
  { op: '-', label: 'subtract' },
  { op: '\u00d7', label: 'multiply by' },
  { op: '\u00f7', label: 'divide by' },
] as const;

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

  const box = useRef<HTMLInputElement>(null);
  /* Where the caret should land once the new value has rendered. Held in a ref
     rather than state: it is not something the UI draws, and making it state
     would render the field twice for every tap. */
  const caret = useRef<number | null>(null);

  useEffect(() => {
    if (caret.current === null || !box.current) return;
    box.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  function insert(op: string) {
    const el = box.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;

    const next = insertOperator(value, start, end, op);
    caret.current = next.caret;
    onChange(next.value);
    el?.focus();
  }

  return (
    <>
      <input
        ref={box}
        id={id}
        name={name}
        /* Numeric keypad, because that is what nearly every entry needs. The
           operators are buttons precisely so this can stay decimal. */
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={showing ? `${id}-calc` : undefined}
        className={`${inputClass(error)} num text-lg`}
      />

      <div className="mt-1.5 flex items-center gap-1.5">
        {OPERATORS.map(({ op, label }) => (
          <button
            key={op}
            type="button"
            tabIndex={-1}
            aria-label={label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(op)}
            className="num h-8 w-9 rounded-[var(--radius-field)] border border-[var(--color-line)] text-sm text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-line-strong)] hover:bg-[var(--color-raised)] active:bg-[var(--color-raised)]"
          >
            {op}
          </button>
        ))}
        <span className="ml-1 text-[11px] text-[var(--color-ink-3)]">
          to add several figures
        </span>
      </div>

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
