import { round2 } from '@/lib/analytics';
import { endOfDay, monthKey, startOfDay, type Day } from '@/lib/time';
import type { Snapshot, Transaction } from '@/lib/types';

/* ===========================================================================
   What the cards cost to use.

   Surcharges and the tax on them are ordinary spend rows, so they are already
   counted in every total on every page — which is exactly why they are
   invisible. Spread across a year and a dozen categories, a fuel surcharge
   here and an EMI charge there never present themselves as one number, and
   one number is the only form in which anyone decides to do something about
   it.

   THE SPLIT THAT MAKES IT ACTIONABLE is avoidable against committed. An EMI's
   interest and its tax were agreed when the instalment plan started and will
   run to its end whatever anyone does now. A fuel surcharge is a choice about
   which card goes into which pump, and it can stop this week. Reporting one
   total invites the wrong conclusion about both.

   Nothing here re-defines a fee: it counts the rows the ledger already files
   under Surcharge and Taxes, so this page and every other agree.
   =========================================================================== */

export type CostKind = 'surcharge' | 'tax';

export type CostRow = {
  key: string;
  total: number;
  count: number;
  share: number;
};

export type CardCost = {
  from: Day;
  to: Day;
  /** Surcharges, fees and interest. */
  surcharge: number;
  /** Tax charged on those. */
  tax: number;
  total: number;
  count: number;
  /** Fees that came with an instalment plan — already committed. */
  committed: number;
  /** Everything else — the part a different habit could change. */
  avoidable: number;
  /** As a share of everything spent in the same window. */
  shareOfSpend: number;
  byCard: CostRow[];
  byMonth: { month: string; total: number }[];
  /** The individual charges, biggest first. */
  largest: Transaction[];
};

const LARGEST = 10;

function isCost(t: Transaction): boolean {
  return t.category === 'Surcharge' || t.category === 'Taxes';
}

export function cardCost(
  snapshot: Snapshot,
  from: Day,
  to: Day,
): CardCost {
  const lo = startOfDay(from);
  const hi = endOfDay(to);

  const inWindow = snapshot.transactions.filter(
    (t) => !t.deleted && t.ts && t.amount != null && t.ts >= lo && t.ts <= hi,
  );

  const fees = inWindow.filter(isCost);
  const sum = (rows: Transaction[]) => round2(rows.reduce((a, t) => a + (t.amount ?? 0), 0));

  const surcharge = sum(fees.filter((t) => t.category === 'Surcharge'));
  const tax = sum(fees.filter((t) => t.category === 'Taxes'));
  const total = round2(surcharge + tax);

  /* Committed means it arrived with an instalment. The counter in the remark
     is what says so — the same tag the EMI tracker groups by — so the two
     cannot disagree about which charges belong to a plan. */
  const committed = sum(fees.filter((t) => Boolean(t.tags.emi)));

  /* Measured against SPEND, not against every row on the card: bill payments
     and lending are not spending, and including them would shrink the share
     into looking harmless. */
  const spend = sum(inWindow.filter((t) => t.kind === 'spend'));

  const byCardSums = new Map<string, { total: number; count: number }>();
  for (const t of fees) {
    const key = t.cardAffected ?? t.method ?? 'Unknown';
    const cur = byCardSums.get(key) ?? { total: 0, count: 0 };
    cur.total += t.amount ?? 0;
    cur.count += 1;
    byCardSums.set(key, cur);
  }

  const byCard: CostRow[] = [...byCardSums.entries()]
    .map(([key, v]) => ({
      key,
      total: round2(v.total),
      count: v.count,
      share: total > 0 ? v.total / total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const monthSums = new Map<string, number>();
  for (const t of fees) {
    const m = monthKey(t.ts!);
    monthSums.set(m, (monthSums.get(m) ?? 0) + (t.amount ?? 0));
  }
  const byMonth = [...monthSums.entries()]
    .map(([month, v]) => ({ month, total: round2(v) }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  return {
    from,
    to,
    surcharge,
    tax,
    total,
    count: fees.length,
    committed,
    avoidable: round2(total - committed),
    shareOfSpend: spend > 0 ? total / spend : 0,
    byCard,
    byMonth,
    largest: [...fees].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, LARGEST),
  };
}
