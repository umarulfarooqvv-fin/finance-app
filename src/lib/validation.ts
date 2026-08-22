import type { FieldErrors } from '@/lib/action-result';
import { MAX_AMOUNT, parseUserAmount } from '@/lib/money';
import { daysInMonth } from '@/lib/time';
import { ALL_CATEGORIES, ALL_METHODS, isCard } from '@/lib/types';

/* ===========================================================================
   Server-side validation for a transaction.

   Pure — no framework, no I/O — so every rule below is unit-testable and runs
   identically whether the entry came from the form, the iPhone Shortcut, or a
   direct POST from something that skipped the UI entirely. Client-side
   validation is a convenience; this is the one that decides.

   The rules encode invariants the live data actually holds, not invented
   ones. Notably: no row in 2,468 has a negative amount, because direction is
   carried by `kind` and `card_direction` — never by the sign of the money. A
   negative amount here would silently invert a balance.
   =========================================================================== */

export const MAX_REMARKS = 500;
/** Nothing is dated before tracking could plausibly have begun. */
export const MIN_DATE = '2015-01-01';
/** Pre-logged EMI plans run about two years out; five gives headroom. */
export const MAX_FUTURE_YEARS = 5;

export type TransactionInput = {
  amount: string | number | null | undefined;
  method: string;
  category: string;
  remarks?: string;
  /** IST wall clock, "YYYY-MM-DDTHH:MM:SS". */
  ts: string;
};

const TS_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** A real point on the calendar, not merely the right shape. */
export function isValidInstant(ts: string): boolean {
  if (!TS_SHAPE.test(ts)) return false;
  const y = Number(ts.slice(0, 4));
  const m = Number(ts.slice(5, 7));
  const d = Number(ts.slice(8, 10));
  const hh = Number(ts.slice(11, 13));
  const mi = Number(ts.slice(14, 16));
  const ss = Number(ts.slice(17, 19));
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > daysInMonth(y, m)) return false;
  return hh <= 23 && mi <= 59 && ss <= 59;
}

/**
 * @param input the entry as submitted
 * @param today IST date, injected so the rule is testable without a clock
 */
export function validateTransaction(input: TransactionInput, today: string): FieldErrors | null {
  const errors: FieldErrors = {};

  // --- Amount ---
  const parsed = parseUserAmount(input.amount);
  if (!parsed.ok) {
    errors['amount'] =
      parsed.reason === 'empty' ? 'Enter an amount.'
      : parsed.reason === 'not-a-number' ? 'That is not a number.'
      : parsed.reason === 'too-precise' ? 'Amounts go to the paisa — at most two decimals.'
      : `Amounts must be under ₹${MAX_AMOUNT.toLocaleString('en-IN')}.`;
  } else if (parsed.amount <= 0) {
    // Direction is carried by the category and method, never by a minus sign.
    errors['amount'] = 'Enter a positive amount. Use the category to say where it went.';
  }

  // --- Date ---
  const ts = (input.ts ?? '').trim();
  if (!ts) {
    errors['ts'] = 'Pick a date.';
  } else if (!isValidInstant(ts)) {
    errors['ts'] = 'That is not a real date.';
  } else {
    const day = ts.slice(0, 10);
    const maxYear = Number(today.slice(0, 4)) + MAX_FUTURE_YEARS;
    if (day < MIN_DATE) errors['ts'] = `Nothing is dated before ${MIN_DATE}.`;
    else if (Number(day.slice(0, 4)) > maxYear) {
      errors['ts'] = `That is more than ${MAX_FUTURE_YEARS} years ahead.`;
    }
  }

  // --- Method ---
  const method = (input.method ?? '').trim();
  if (!method) {
    // Five rows in the live data have a blank method and were counting as
    // spend with no source. New entries may not repeat that.
    errors['method'] = 'Choose where the money came from.';
  } else if (!(ALL_METHODS as readonly string[]).includes(method)) {
    errors['method'] = 'That is not a known payment method.';
  }

  // --- Category ---
  const category = (input.category ?? '').trim();
  if (!category) {
    errors['category'] = 'Choose a category.';
  } else if (!(ALL_CATEGORIES as readonly string[]).includes(category)) {
    errors['category'] = 'That is not a known category.';
  }

  // --- Cross-field ---
  // A card cannot pay its own bill: the row would add and remove the same
  // debt, and the balance would silently not move.
  if (method && category && isCard(category) && method === category) {
    errors['method'] = `A ${category} bill cannot be paid from ${category} itself.`;
  }

  if ((input.remarks ?? '').length > MAX_REMARKS) {
    errors['remarks'] = `Keep remarks under ${MAX_REMARKS} characters.`;
  }

  return Object.keys(errors).length ? errors : null;
}

export type IncomeInput = {
  amount: string | number | null | undefined;
  source: string;
  account: string;
  remarks?: string;
  ts: string;
};

export function validateIncome(input: IncomeInput, today: string): FieldErrors | null {
  const errors: FieldErrors = {};

  const parsed = parseUserAmount(input.amount);
  if (!parsed.ok) {
    errors['amount'] =
      parsed.reason === 'empty' ? 'Enter an amount.'
      : parsed.reason === 'too-precise' ? 'Amounts go to the paisa — at most two decimals.'
      : parsed.reason === 'out-of-range' ? `Amounts must be under ₹${MAX_AMOUNT.toLocaleString('en-IN')}.`
      : 'That is not a number.';
  } else if (parsed.amount <= 0) {
    errors['amount'] = 'Income must be a positive amount.';
  }

  const ts = (input.ts ?? '').trim();
  if (!ts) errors['ts'] = 'Pick a date.';
  else if (!isValidInstant(ts)) errors['ts'] = 'That is not a real date.';
  else if (Number(ts.slice(0, 4)) > Number(today.slice(0, 4)) + MAX_FUTURE_YEARS) {
    errors['ts'] = `That is more than ${MAX_FUTURE_YEARS} years ahead.`;
  }

  if (!(input.source ?? '').trim()) errors['source'] = 'Where did it come from?';
  if (!(input.account ?? '').trim()) errors['account'] = 'Which account received it?';
  if ((input.remarks ?? '').length > MAX_REMARKS) {
    errors['remarks'] = `Keep remarks under ${MAX_REMARKS} characters.`;
  }

  return Object.keys(errors).length ? errors : null;
}
