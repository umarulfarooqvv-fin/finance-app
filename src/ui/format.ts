/* ===========================================================================
   Money and number rendering.

   Everything here is en-IN: the lakh/crore grouping (1,23,456.78) is what
   Farooq reads, and Intl gets it right natively. Kept free of React and of
   'server-only' so both server and client components can use it.
   =========================================================================== */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const plain = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "₹1,23,456.78". Nullish renders as an em dash, never as ₹0.00 — an absent
    figure and a zero figure mean different things on a balance sheet. */
export function money(n: number | null | undefined, opts: { whole?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return opts.whole ? inrWhole.format(n) : inr.format(n);
}

/** Money without the symbol, for tables that carry ₹ in the column header. */
export function amount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return plain.format(n);
}

/**
 * Compact form for tight spaces: ₹1.2L, ₹34.4k, ₹2.1Cr.
 * Indian units, because "₹120K" is not how a lakh is read here.
 */
export function moneyCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v >= 1_00_00_000) return `${sign}₹${(v / 1_00_00_000).toFixed(v >= 10_00_00_000 ? 0 : 1)}Cr`;
  if (v >= 1_00_000) return `${sign}₹${(v / 1_00_000).toFixed(v >= 10_00_000 ? 0 : 1)}L`;
  if (v >= 1_000) return `${sign}₹${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return `${sign}₹${v.toFixed(0)}`;
}

export function percent(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

/** Signed change, for comparisons: "+12.4%" / "-3.0%". */
export function delta(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const s = (n * 100).toFixed(digits);
  return n > 0 ? `+${s}%` : `${s}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** "3 days", "1 day", "today" — for due-date countdowns. */
export function dayCount(n: number): string {
  const v = Math.abs(n);
  return `${v} ${plural(v, 'day')}`;
}
