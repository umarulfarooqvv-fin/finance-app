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

/* ===========================================================================
   Settings.

   These rules guard the numbers every OTHER number is computed from. A wrong
   transaction is one wrong row; a wrong bill date silently reshuffles which
   statement every charge on that card belongs to, for the whole history.

   Signed amounts are allowed here, unlike on a transaction. An overpaid card
   carries a negative balance and the engine depends on that being expressible
   — see "totalDebtLive can be negative" in CLAUDE.md — and a bank account can
   genuinely be overdrawn.
   =========================================================================== */

export type CardSettingsInput = {
  name: string;
  billDate: string | number;
  dueDay: string | number | null;
  dueCycle: string;
  graceDays: string | number;
  creditLimit: string | number | null | undefined;
  openingBalance: string | number | null | undefined;
  /** "YYYY-MM-DD", or '' for "use all history". */
  openingDate: string;
  statementBoundary: string;
  active: boolean;
};

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A whole number in [lo, hi], or null when it is not one. */
function whole(v: string | number | null | undefined, lo: number, hi: number): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

/** A signed money figure, to the paisa, within the app's ceiling. */
function signedAmount(v: string | number | null | undefined): { ok: true; value: number } | { ok: false; why: string } {
  if (v === '' || v === null || v === undefined) return { ok: true, value: 0 };
  const raw = String(v).replace(/[,\s₹]/g, '');
  /* Decided on the STRING, not on the float. `Math.round(n * 100)` games are
     how a figure ends up a paisa away from what was typed, and this is the
     number every balance on the card is then derived from. */
  const m = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) return { ok: false, why: 'That is not a number.' };
  if ((m[3] ?? '').length > 2) return { ok: false, why: 'At most two decimals.' };

  const paise = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) return { ok: false, why: 'That number is too large.' };
  const value = (m[1] === '-' ? -paise : paise) / 100;
  if (Math.abs(value) > MAX_AMOUNT) {
    return { ok: false, why: `Keep this under ₹${MAX_AMOUNT.toLocaleString('en-IN')}.` };
  }
  return { ok: true, value };
}

export function validateCardSettings(input: CardSettingsInput, today: string): FieldErrors | null {
  const errors: FieldErrors = {};

  if (!input.name?.trim()) errors['name'] = 'Missing card.';

  /* 29, 30 and 31 are refused rather than clamped. A bill date of 31 has no
     meaning in February, and silently treating it as the 28th would move a
     month's worth of charges onto a different statement without saying so. */
  if (whole(input.billDate, 1, 28) === null) {
    errors['billDate'] = 'Bill date must be a day from 1 to 28.';
  }

  const due = input.dueDay === '' || input.dueDay === null ? null : whole(input.dueDay, 1, 28);
  if (input.dueDay !== '' && input.dueDay !== null && due === null) {
    errors['dueDay'] = 'Due day must be a day from 1 to 28, or left blank.';
  }

  if (input.dueCycle !== 'same' && input.dueCycle !== 'next') {
    errors['dueCycle'] = 'Choose whether the due day is in the same month or the next.';
  }

  if (whole(input.graceDays, 0, 60) === null) {
    errors['graceDays'] = 'Grace days must be a whole number from 0 to 60.';
  }

  const limit = signedAmount(input.creditLimit);
  if (!limit.ok) errors['creditLimit'] = limit.why;
  else if (limit.value < 0) errors['creditLimit'] = 'A credit limit cannot be negative.';

  const opening = signedAmount(input.openingBalance);
  if (!opening.ok) errors['openingBalance'] = opening.why;

  const date = (input.openingDate ?? '').trim();
  if (date) {
    if (!DAY_ONLY.test(date) || !isValidInstant(`${date}T00:00:00`)) {
      errors['openingDate'] = 'That is not a valid date.';
    } else if (date < MIN_DATE) {
      errors['openingDate'] = `Nothing is tracked before ${MIN_DATE}.`;
    } else if (date > today) {
      // Tracking cannot start in the future: every row would be skipped and
      // the card would read as having no history at all.
      errors['openingDate'] = 'Tracking cannot start in the future.';
    }
  }

  if (input.statementBoundary !== 'inclusive' && input.statementBoundary !== 'exclusive') {
    errors['statementBoundary'] = 'Choose how the bill date itself is treated.';
  }

  return Object.keys(errors).length ? errors : null;
}

export type AccountSettingsInput = {
  name: string;
  kind: string;
  openingBalance: string | number | null | undefined;
  /** "YYYY-MM-DD", or '' for "count all history". */
  since: string;
  active: boolean;
};

export function validateAccountSettings(input: AccountSettingsInput, today: string): FieldErrors | null {
  const errors: FieldErrors = {};

  if (!input.name?.trim()) errors['name'] = 'Missing account.';
  if (input.kind !== 'bank' && input.kind !== 'cash') errors['kind'] = 'Choose bank or cash.';

  const opening = signedAmount(input.openingBalance);
  if (!opening.ok) errors['openingBalance'] = opening.why;

  const date = (input.since ?? '').trim();
  if (date) {
    if (!DAY_ONLY.test(date) || !isValidInstant(`${date}T00:00:00`)) {
      errors['since'] = 'That is not a valid date.';
    } else if (date < MIN_DATE) {
      errors['since'] = `Nothing is tracked before ${MIN_DATE}.`;
    } else if (date > today) {
      errors['since'] = 'Tracking cannot start in the future.';
    }
  }

  return Object.keys(errors).length ? errors : null;
}

/** Both validators accept the same loose input the form produces; these
    normalise it once the rules have passed. */
export function normaliseAmount(v: string | number | null | undefined): number {
  const r = signedAmount(v);
  return r.ok ? r.value : 0;
}

export function normaliseWhole(v: string | number | null | undefined, fallback: number): number {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isInteger(n) ? n : fallback;
}
