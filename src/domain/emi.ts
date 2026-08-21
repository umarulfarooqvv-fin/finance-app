import { round2 } from './analytics.ts';
import { dayOf, endOfDay, monthKey, type Day, type Instant } from './time.ts';
import type { Snapshot, Transaction } from './types.ts';

/* ===========================================================================
   EMI tracker (spec §3.7).

   Instalments are not a separate record anywhere — they are ordinary
   transactions whose remarks carry an "n/m" counter, split across up to three
   rows per month: the principal, the card's surcharge, and tax on it. This
   regroups them into the thing a person actually has in mind: one purchase,
   paid off over m months, n of which are done.
   =========================================================================== */

export type EmiInstalment = {
  n: number;
  ts: Instant;
  day: Day;
  month: string;
  principal: number;
  surcharge: number;
  tax: number;
  total: number;
  /** False while the row is dated in the future (pre-logged). */
  posted: boolean;
};

export type EmiPlan = {
  name: string;
  card: string | null;
  /** Total instalments in the plan, from the counter's denominator. */
  months: number;
  paidCount: number;
  remainingCount: number;
  instalmentAmount: number;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
  nextDue: Day | null;
  lastPaid: Day | null;
  complete: boolean;
  instalments: EmiInstalment[];
};

/** Group instalment rows into plans, newest activity first. */
export function emiPlans(snapshot: Snapshot, today: Day): EmiPlan[] {
  const now = endOfDay(today);
  const groups = new Map<string, { card: string | null; months: number; rows: Transaction[] }>();

  for (const t of snapshot.transactions) {
    if (t.deleted || !t.ts || t.amount == null) continue;
    const emi = t.tags.emi;
    if (!emi || emi === true) continue;

    const name = (t.tags.emiName || 'Unnamed plan').trim();
    const key = `${name.toLowerCase()}::${emi.m}`;
    const g = groups.get(key) ?? { card: t.cardAffected, months: emi.m, rows: [] };
    // The card is whatever the principal row was charged to.
    if (t.tags.emiComponent === 'principal' && t.cardAffected) g.card = t.cardAffected;
    g.rows.push(t);
    groups.set(key, g);
  }

  const plans: EmiPlan[] = [];

  for (const [, g] of groups) {
    // Collapse the principal/surcharge/tax rows of each month into one instalment.
    const byN = new Map<number, EmiInstalment>();

    for (const t of g.rows) {
      const emi = t.tags.emi;
      if (!emi || emi === true) continue;
      const ts = t.ts as Instant;
      const cur = byN.get(emi.n) ?? {
        n: emi.n, ts, day: dayOf(ts), month: monthKey(ts),
        principal: 0, surcharge: 0, tax: 0, total: 0, posted: ts <= now,
      };
      const amt = t.amount as number;
      if (t.tags.emiComponent === 'surcharge') cur.surcharge += amt;
      else if (t.tags.emiComponent === 'tax') cur.tax += amt;
      else cur.principal += amt;
      cur.total += amt;
      // The earliest row of the month sets the date.
      if (ts < cur.ts) {
        cur.ts = ts;
        cur.day = dayOf(ts);
        cur.month = monthKey(ts);
        cur.posted = ts <= now;
      }
      byN.set(emi.n, cur);
    }

    const instalments = [...byN.values()]
      .map((i) => ({
        ...i,
        principal: round2(i.principal),
        surcharge: round2(i.surcharge),
        tax: round2(i.tax),
        total: round2(i.total),
      }))
      .sort((a, b) => a.n - b.n);

    const posted = instalments.filter((i) => i.posted);
    const pending = instalments.filter((i) => !i.posted);
    const name = g.rows.find((r) => r.tags.emiName)?.tags.emiName ?? 'Unnamed plan';

    // Typical instalment, taken from what has actually been charged.
    const typical = posted.length
      ? round2(posted.reduce((a, i) => a + i.total, 0) / posted.length)
      : round2(instalments[0]?.total ?? 0);

    const paidAmount = round2(posted.reduce((a, i) => a + i.total, 0));
    const remainingCount = Math.max(0, g.months - posted.length);

    plans.push({
      name,
      card: g.card,
      months: g.months,
      paidCount: posted.length,
      remainingCount,
      instalmentAmount: typical,
      paidAmount,
      // Prefer real pre-logged amounts where they exist; estimate the rest.
      remainingAmount: round2(
        pending.reduce((a, i) => a + i.total, 0) +
          Math.max(0, remainingCount - pending.length) * typical,
      ),
      totalAmount: round2(paidAmount + pending.reduce((a, i) => a + i.total, 0) +
        Math.max(0, remainingCount - pending.length) * typical),
      nextDue: pending[0]?.day ?? null,
      lastPaid: posted.length ? (posted[posted.length - 1] as EmiInstalment).day : null,
      complete: remainingCount === 0,
      instalments,
    });
  }

  return plans.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1;
    return b.remainingAmount - a.remainingAmount;
  });
}

/** Headline totals for the EMI section. */
export function emiSummary(plans: EmiPlan[]) {
  const active = plans.filter((p) => !p.complete);
  return {
    activeCount: active.length,
    monthlyOutgo: round2(active.reduce((a, p) => a + p.instalmentAmount, 0)),
    remainingTotal: round2(active.reduce((a, p) => a + p.remainingAmount, 0)),
  };
}
