/* ===========================================================================
   Exact money handling.

   Rupee amounts are parsed to integer PAISE first and only then converted
   back, so "1,234.56" can never become 1234.5599999999999. Floating point is
   fine for holding a 2dp value; it is the arithmetic on the way in that goes
   wrong, and that is what this avoids.

   A deliberate asymmetry, grounded in the real data:

     - Amounts a PERSON types are limited to 2dp. Paise is the smallest unit
       anyone can actually pay.
     - Amounts the BANK produced are not. Real rows carry 51.929568 and
       288.4976 — EMI tax and surcharge computed to full precision. Those are
       stored as they came, because rounding somebody else's arithmetic to
       make it look tidy is how a ledger stops matching the statement it is
       supposed to reconcile against.

   So parsing is strict at the form and lossless at the import boundary.
   =========================================================================== */

/** The most a single entry may be. A sanity bound, not a business rule. */
export const MAX_AMOUNT = 10_000_000; // ₹1 crore

export type MoneyParse =
  | { ok: true; amount: number; paise: number }
  | { ok: false; reason: 'empty' | 'not-a-number' | 'too-precise' | 'out-of-range' };

/**
 * Parse a user-entered amount. Accepts "1,234.56", "₹1234", " 99 ".
 * Rejects anything finer than a paisa — see the note above.
 */
export function parseUserAmount(raw: string | number | null | undefined): MoneyParse {
  if (raw === null || raw === undefined) return { ok: false, reason: 'empty' };

  const text = String(raw).replace(/[₹,\s]/g, '').trim();
  if (text === '') return { ok: false, reason: 'empty' };
  if (!/^-?\d*(\.\d*)?$/.test(text)) return { ok: false, reason: 'not-a-number' };

  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [whole = '0', frac = ''] = body.split('.');
  if (frac.length > 2) return { ok: false, reason: 'too-precise' };

  // Build paise from the digits themselves — never whole*100 on a float.
  const paise = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2) || '0');
  if (!Number.isFinite(paise)) return { ok: false, reason: 'not-a-number' };

  const signed = negative ? -paise : paise;
  const amount = signed / 100;
  if (Math.abs(amount) > MAX_AMOUNT) return { ok: false, reason: 'out-of-range' };

  return { ok: true, amount, paise: signed };
}

/** Round for DISPLAY and for aggregate totals. Half-up, like a bank statement. */
export function round2(n: number): number {
  // Scale-and-shift avoids 1.005 -> 1.00 from binary representation.
  return Math.sign(n) * Math.round(Math.abs(n) * 100 + Number.EPSILON * 100) / 100;
}

/** Sum a list the way the UI displays it: round each row, then add. */
export function sumDisplayed(values: number[]): number {
  return round2(values.reduce((a, v) => a + round2(v), 0));
}

/** Sum at full precision, then round once. */
export function sumExact(values: number[]): number {
  return round2(values.reduce((a, v) => a + v, 0));
}
