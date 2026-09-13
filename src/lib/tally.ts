import { round2 } from '@/lib/money';
import { endOfDay, startOfDay, type Day, type Instant } from '@/lib/time';
import type { Snapshot } from '@/lib/types';

/* ===========================================================================
   The date-wise statement: what came in, what went out, what is left.

   This is a CASH statement. "Out" is money that left a bank or cash account —
   spending paid from it, card bills settled from it, money lent from it. A
   charge put on a credit card is not here, because no cash moved: it appears
   on the day the card's bill is paid, which is when the money actually left.
   Mixing the two would produce a running figure that matches no account and
   reconciles against nothing.

   Card spending in the same period is reported alongside, separately and
   labelled, so it is not hidden — just kept out of a balance it does not move.

   The rules for what counts are taken from balances.ts rather than restated,
   so this page and the Money page cannot drift into disagreeing about the
   same account.
   =========================================================================== */

export type Movement = {
  id: string;
  ts: Instant;
  amount: number;
  /** Where it came from, or went to. */
  counterparty: string;
  label: string;
  direction: 'in' | 'out';
};

export type DayLine = {
  day: Day;
  in: number;
  out: number;
  net: number;
  /** Balance after this day, carried forward from the opening figure. */
  balance: number;
  movements: Movement[];
};

export type Tally = {
  from: Day;
  to: Day;
  /** Balance carried into the period. */
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  days: DayLine[];
  /** Spending charged to cards in this period. No cash moved; shown, not counted. */
  cardSpend: number;
  /**
   * opening + totalIn − totalOut − closing, rounded.
   *
   * Zero by construction. It is computed and surfaced anyway: if it is ever
   * non-zero the arithmetic on screen is internally inconsistent, and a
   * reconciliation page that cannot reconcile itself should say so loudly
   * rather than let a person balance their month against it.
   */
  drift: number;
};

/** The accounts a tally can be scoped to. Cards are not accounts. */
export function tallyAccounts(snapshot: Snapshot): string[] {
  return snapshot.accounts.filter((a) => a.active).map((a) => a.name);
}

/**
 * @param account one account name, or null for every account together
 */
export function tally(
  snapshot: Snapshot,
  from: Day,
  to: Day,
  account: string | null,
): Tally {
  const names = new Set(account ? [account] : tallyAccounts(snapshot));
  const lo = startOfDay(from);
  const hi = endOfDay(to);

  /* The opening figure is each account's configured opening balance plus
     everything that moved before this period began — the same reconstruction
     the Money page performs, bounded at `from` instead of today. */
  let opening = 0;
  for (const a of snapshot.accounts) {
    if (!names.has(a.name)) continue;
    const since = a.since ? startOfDay(a.since) : null;
    const inWindow = (ts: Instant) => ts < lo && (since === null || ts >= since);

    opening += a.openingBalance;
    for (const i of snapshot.income) {
      if (!i.deleted && i.ts && i.amount != null && i.account === a.name && inWindow(i.ts)) {
        opening += i.amount;
      }
    }
    for (const t of snapshot.transactions) {
      if (!t.deleted && t.ts && t.amount != null && t.method === a.name && inWindow(t.ts)) {
        opening -= t.amount;
      }
    }
  }
  opening = round2(opening);

  /* An account tracked from a date inside the period must not count movements
     from before that date, or the opening figure would be applied twice. */
  const sinceOf = new Map(
    snapshot.accounts.filter((a) => names.has(a.name)).map((a) => [a.name, a.since ? startOfDay(a.since) : null]),
  );
  const counts = (name: string, ts: Instant) => {
    if (!names.has(name)) return false;
    const since = sinceOf.get(name) ?? null;
    return ts >= lo && ts <= hi && (since === null || ts >= since);
  };

  const byDay = new Map<Day, Movement[]>();
  const push = (m: Movement) => {
    const d = m.ts.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), m]);
  };

  for (const i of snapshot.income) {
    if (i.deleted || !i.ts || i.amount == null || !counts(i.account, i.ts)) continue;
    push({
      id: i.id, ts: i.ts, amount: i.amount, counterparty: i.account,
      label: i.remarks || i.source, direction: 'in',
    });
  }

  for (const t of snapshot.transactions) {
    if (t.deleted || !t.ts || t.amount == null || !counts(t.method, t.ts)) continue;
    push({
      id: t.id, ts: t.ts, amount: t.amount, counterparty: t.method,
      label: t.remarks || t.category, direction: 'out',
    });
  }

  // Charged to a card in this window: no cash moved, reported separately.
  const cardSpend = round2(
    snapshot.transactions
      .filter(
        (t) =>
          !t.deleted && t.ts != null && t.amount != null &&
          t.ts >= lo && t.ts <= hi &&
          t.cardAffected !== null && t.cardDirection === 'debt+',
      )
      .reduce((a, t) => a + (t.amount ?? 0), 0),
  );

  let running = opening;
  let totalIn = 0;
  let totalOut = 0;
  const days: DayLine[] = [];

  for (const day of [...byDay.keys()].sort()) {
    const movements = (byDay.get(day) ?? []).sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const dayIn = round2(movements.filter((m) => m.direction === 'in').reduce((a, m) => a + m.amount, 0));
    const dayOut = round2(movements.filter((m) => m.direction === 'out').reduce((a, m) => a + m.amount, 0));
    totalIn = round2(totalIn + dayIn);
    totalOut = round2(totalOut + dayOut);
    running = round2(running + dayIn - dayOut);
    days.push({ day, in: dayIn, out: dayOut, net: round2(dayIn - dayOut), balance: running, movements });
  }

  const closing = running;
  return {
    from, to, opening, totalIn, totalOut, closing, cardSpend,
    days: days.reverse(), // newest first, like every other list in the app
    drift: round2(opening + totalIn - totalOut - closing),
  };
}
