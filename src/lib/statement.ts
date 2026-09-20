import { creditLedger } from '@/lib/credit';
import {
  cycleFor, cycleOverridesFrom, daysUntilDue, dueStatus, recentCycles,
  type Cycle, type CycleOverrides, type DueStatus,
} from '@/lib/cycles';
import { dayOf, endOfDay, startOfDay, type Day, type Instant } from '@/lib/time';
import type { Card, Snapshot, Transaction } from '@/lib/types';

/* ===========================================================================
   Statement View (spec §3.2) — the master dashboard.

   One pass over the transaction list per card. v2 issued roughly ten separate
   SQL SUM() queries per card against a SQLite cache; this walks the array once
   and accumulates every figure together, which is both faster and far easier
   to reason about because all the arithmetic sits in one place.

   The definitions, in the order they build on each other:

     billedClosing   opening balance + everything charged up to the statement
                     date - everything paid up to it. This is the bill.
     remainingDue    what is still owed on that bill after payments made since
                     it was generated.
     unbilled        charges since the statement date, less any payment that
                     went beyond clearing the bill.
     totalDebtLive   the true current balance: bill + unbilled activity. It can
                     legitimately go negative when a card is overpaid.

   `openingBalance` stands in for history from before tracking began, so rows
   older than `openingDate` are skipped rather than counted twice.
   =========================================================================== */

export type StatementRow = {
  card: string;
  /** CSS variable reference, e.g. 'var(--card-3)'. */
  color: string;
  creditLimit: number;
  cycle: Cycle;
  daysLeft: number;
  status: DueStatus;

  remainingDueBill: number;
  totalDebtLive: number;
  unbilled: number;

  /** The same two figures with still-unrepaid money lent to others removed. */
  remainingDueExcl: number;
  totalDebtExcl: number;
  /** How much unrepaid lending sits on this card. */
  creditGivenOutstanding: number;

  /** null when no limit is configured — never render a bar without one. */
  utilization: number | null;

  cycleMath: {
    openingBalance: number;
    cycleSpends: number;
    cycleRepayments: number;
    closingBalance: number;
  };

  verified: { verified: number; unverified: number };
};

export type StatementView = {
  rows: StatementRow[];
  totals: {
    remainingDueBill: number;
    totalDebtLive: number;
    unbilled: number;
    remainingDueExcl: number;
    totalDebtExcl: number;
    limits: number;
    utilization: number | null;
  };
  asOf: Instant;
};

/** Rows that count toward a card's balance, in time order. */
function cardRows(snapshot: Snapshot, card: Card, upTo: Instant): Transaction[] {
  const floor = card.openingDate ? startOfDay(card.openingDate) : null;
  return snapshot.transactions
    .filter(
      (t) =>
        !t.deleted &&
        t.cardAffected === card.name &&
        t.amount != null &&
        t.ts != null &&
        t.ts <= upTo &&
        (floor === null || t.ts >= floor),
    )
    .sort((a, b) => (a.ts! < b.ts! ? -1 : a.ts! > b.ts! ? 1 : 0));
}

export function cardStatement(
  snapshot: Snapshot,
  card: Card,
  today: Day,
  /** Per-lending unrepaid balance, keyed by transaction id (see credit.ts). */
  outstandingByTx: Record<string, number> = {},
  overrides: CycleOverrides = {},
): StatementRow {
  const cycle = cycleFor(card, today, overrides);
  const now = endOfDay(today);
  /* periodEnd, NOT statementEnd. They differ by a day exactly when the bank
     cut this statement before the bill date's own spending posted, which is
     the case this boundary exists to model. */
  const stmtEnd = endOfDay(cycle.periodEnd);
  const cycleStart = startOfDay(cycle.cycleStart);

  let debtThroughEnd = 0;
  let paidThroughEnd = 0;
  let spendsAfter = 0;
  let paymentsAfter = 0;
  let debtBeforeCycle = 0;
  let paidBeforeCycle = 0;
  let cycleSpends = 0;
  let cycleRepayments = 0;
  let verified = 0;
  let unverified = 0;

  const rows = cardRows(snapshot, card, now);
  for (const t of rows) {
    const amt = t.amount as number;
    const ts = t.ts as Instant;
    const isCharge = t.cardDirection === 'debt+';

    if (ts <= stmtEnd) {
      if (isCharge) debtThroughEnd += amt;
      else paidThroughEnd += amt;

      if (ts < cycleStart) {
        if (isCharge) debtBeforeCycle += amt;
        else paidBeforeCycle += amt;
      } else {
        if (isCharge) cycleSpends += amt;
        else cycleRepayments += amt;
      }
    } else {
      if (isCharge) spendsAfter += amt;
      else paymentsAfter += amt;
    }

    // Reconciliation split covers the live balance, which is what you check
    // a statement against.
    if (isCharge) {
      if (t.verified) verified += amt;
      else unverified += amt;
    }
  }

  const opening = card.openingBalance || 0;
  const billedClosing = opening + debtThroughEnd - paidThroughEnd;

  // A payment made after the statement first clears the bill; only what is
  // left over counts against unbilled spend.
  const billPositive = Math.max(0, billedClosing);
  const appliedToBill = Math.min(paymentsAfter, billPositive);
  const remainingDueBill = billPositive - appliedToBill;

  // An overpaid card (negative bill) carries its credit into the unbilled
  // figure, which is why min(0, billedClosing) is added rather than clamped.
  const unbilled = spendsAfter - (paymentsAfter - appliedToBill) + Math.min(0, billedClosing);
  const totalDebtLive = billedClosing + spendsAfter - paymentsAfter;

  // Which of the charges still sitting in the balance is money lent out.
  const lentInBalance = creditStillInBalance(rows, card, outstandingByTx, now, stmtEnd);
  const creditOutstanding = round2(Math.min(lentInBalance.live, Math.max(0, totalDebtLive)));
  const creditBilled = round2(Math.min(lentInBalance.billed, remainingDueBill));
  const remainingDueExcl = Math.max(0, remainingDueBill - creditBilled);
  const totalDebtExcl = totalDebtLive - creditOutstanding;

  const daysLeft = daysUntilDue(cycle, today);

  return {
    card: card.name,
    color: cardColor(card.slot),
    creditLimit: card.creditLimit,
    cycle,
    daysLeft,
    status: dueStatus(remainingDueBill, daysLeft),
    remainingDueBill: round2(remainingDueBill),
    totalDebtLive: round2(totalDebtLive),
    unbilled: round2(unbilled),
    remainingDueExcl: round2(remainingDueExcl),
    totalDebtExcl: round2(totalDebtExcl),
    creditGivenOutstanding: round2(creditOutstanding),
    utilization: card.creditLimit > 0 ? totalDebtLive / card.creditLimit : null,
    cycleMath: {
      openingBalance: round2(opening + debtBeforeCycle - paidBeforeCycle),
      cycleSpends: round2(cycleSpends),
      cycleRepayments: round2(cycleRepayments),
      closingBalance: round2(opening + debtBeforeCycle - paidBeforeCycle + cycleSpends - cycleRepayments),
    },
    verified: { verified: round2(verified), unverified: round2(unverified) },
  };
}

export function statementView(snapshot: Snapshot, today: Day = dayOf(snapshot.loadedAt)): StatementView {
  const credit = creditLedger(snapshot, endOfDay(today));
  const overrides = cycleOverridesFrom(snapshot.config);
  const rows = snapshot.cards
    .filter((c) => c.active)
    .map((c) => cardStatement(snapshot, c, today, credit.outstandingByTx, overrides))
    .sort((a, b) => a.daysLeft - b.daysLeft || b.totalDebtLive - a.totalDebtLive);

  const sum = (pick: (r: StatementRow) => number) => round2(rows.reduce((a, r) => a + pick(r), 0));
  const limits = sum((r) => r.creditLimit || 0);
  const totalDebtLive = sum((r) => r.totalDebtLive);

  return {
    rows,
    totals: {
      remainingDueBill: sum((r) => r.remainingDueBill),
      totalDebtLive,
      unbilled: sum((r) => r.unbilled),
      remainingDueExcl: sum((r) => r.remainingDueExcl),
      totalDebtExcl: sum((r) => r.totalDebtExcl),
      limits,
      utilization: limits > 0 ? totalDebtLive / limits : null,
    },
    asOf: endOfDay(today),
  };
}

/* --- Per-card detail (spec §3.3) ------------------------------------------ */

export type LedgerEntry = {
  id: string;
  ts: Instant;
  day: Day;
  description: string;
  category: string;
  debit: number | null;
  credit: number | null;
  verified: boolean;
};

export type CardDetail = {
  row: StatementRow;
  /** Rows on the statement that was generated — the bill you have to pay. */
  billed: LedgerEntry[];
  /** Rows since then — the balance that is still building. */
  unbilled: LedgerEntry[];
};

export function cardDetail(snapshot: Snapshot, card: Card, today: Day): CardDetail {
  const credit = creditLedger(snapshot, endOfDay(today));
  const overrides = cycleOverridesFrom(snapshot.config);
  const row = cardStatement(snapshot, card, today, credit.outstandingByTx, overrides);
  const stmtEnd = endOfDay(row.cycle.periodEnd);
  const cycleStart = startOfDay(row.cycle.cycleStart);

  const entry = (t: Transaction): LedgerEntry => ({
    id: t.id,
    ts: t.ts as Instant,
    day: dayOf(t.ts as Instant),
    description: t.remarks || t.category || '—',
    category: t.category,
    debit: t.cardDirection === 'debt+' ? (t.amount as number) : null,
    credit: t.cardDirection === 'debt-' ? (t.amount as number) : null,
    verified: t.verified,
  });

  const rows = cardRows(snapshot, card, endOfDay(today));
  return {
    row,
    billed: rows.filter((t) => t.ts! >= cycleStart && t.ts! <= stmtEnd).map(entry),
    unbilled: rows.filter((t) => t.ts! > stmtEnd).map(entry),
  };
}

/**
 * How much of what is STILL OWED on this card is money lent to other people.
 *
 * The naive answer — total up every credit-given charge — is wrong once a bill
 * has been paid: money you fronted in March and settled in April is your own
 * discharged debt, not an outstanding loan sitting in today's balance.
 *
 * So payments are allocated against charges oldest-first (the same FIFO
 * reasoning the credit ledger uses for repayments), leaving the tail of
 * charges that nobody has paid for yet. That tail IS the current balance. The
 * figure returned is the part of that tail which was lent out AND which the
 * borrower has not paid back — money that is neither your spending nor yet
 * back in your pocket.
 */
function creditStillInBalance(
  rows: Transaction[],
  card: Card,
  outstandingByTx: Record<string, number>,
  now: Instant,
  stmtEnd: Instant,
): { live: number; billed: number } {
  // The opening balance behaves as the oldest charge on the card.
  let unpaidOpening = Math.max(0, card.openingBalance || 0);
  const charges: { ts: Instant; remaining: number; lent: number }[] = [];

  for (const t of rows) {
    if (t.ts == null || t.amount == null || t.ts > now) continue;
    if (t.cardDirection === 'debt+') {
      charges.push({
        ts: t.ts,
        remaining: t.amount,
        // Only the still-unrepaid slice of a lending counts as lent-out money.
        lent: t.kind === 'credit_given' ? Math.min(t.amount, outstandingByTx[t.id] ?? 0) : 0,
      });
    } else {
      // A payment settles the opening balance first, then charges in order.
      let pool = t.amount;
      const fromOpening = Math.min(pool, unpaidOpening);
      unpaidOpening -= fromOpening;
      pool -= fromOpening;
      for (const c of charges) {
        if (pool <= 0) break;
        const applied = Math.min(pool, c.remaining);
        // A partly-paid charge sheds its lent portion proportionally.
        if (c.remaining > 0) c.lent -= c.lent * (applied / c.remaining);
        c.remaining -= applied;
        pool -= applied;
      }
    }
  }

  let live = 0;
  let billed = 0;
  for (const c of charges) {
    if (c.lent <= 0) continue;
    live += c.lent;
    if (c.ts <= stmtEnd) billed += c.lent;
  }
  return { live: round2(live), billed: round2(billed) };
}

/** Resolve a palette slot to its themed CSS variable. */
export function cardColor(slot: number): string {
  const n = Number.isFinite(slot) && slot >= 1 && slot <= 6 ? Math.floor(slot) : 1;
  return `var(--card-${n})`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ===========================================================================
   Every cycle a card has had, side by side.

   One statement tells you what this month cost. It cannot tell you where a
   balance that should be zero came from, because the answer is always in an
   earlier month — a bill paid short, an amount typed wrong, a payment never
   recorded — and it then rolls forward for ever, looking like a fresh problem
   every month.

   The column that finds it is `carriedIn`: the opening balance MINUS what was
   paid during the cycle. Pay a bill in full and it is zero. The first row
   where it stops being zero is the month the error entered, and every row
   after it inherits the number.

   Nothing is recomputed here. `cardStatement` already knows how to value a
   card on a given day, and asking it about a past statement date gives that
   cycle — so the history is the same arithmetic the card's own page shows,
   evaluated once per cycle, rather than a second implementation that could
   disagree with it.
   =========================================================================== */

export type HistoryRow = {
  cycle: Cycle;
  opening: number;
  spends: number;
  payments: number;
  closing: number;
  /** Opening less what was paid in the cycle: what the previous bill left
      behind. Zero when that bill was cleared. */
  carriedIn: number;
};

export function statementHistory(
  snapshot: Snapshot,
  card: Card,
  today: Day,
  outstandingByTx: Record<string, number>,
  overrides: CycleOverrides = {},
  count = 18,
): HistoryRow[] {
  return recentCycles(card, today, count, overrides)
    .map((cycle) => {
      const m = cardStatement(snapshot, card, cycle.statementEnd, outstandingByTx, overrides)
        .cycleMath;
      return {
        cycle,
        opening: m.openingBalance,
        spends: m.cycleSpends,
        payments: m.cycleRepayments,
        closing: m.closingBalance,
        // Never negative: paying MORE than the old bill is paying this cycle's
        // spending early, which is not something left behind.
        carriedIn: round2(Math.max(0, m.openingBalance - m.cycleRepayments)),
      };
    })
    /* Stop at the card's opening date. Cycles before it are all zero — the
       opening balance replaces that history rather than adding to it — and a
       run of empty rows buries the ones that say something. */
    .filter((r) => !card.openingDate || r.cycle.periodEnd >= card.openingDate)
    .reverse()
    /* The OLDEST row never carries anything in. Its opening balance is the
       card's opening balance, which stands in for history from before tracking
       began — there is no earlier bill in the data that could have been paid
       short. Left as-is it reports the whole opening balance as a shortfall on
       the first row of every card, which is a false positive in exactly the
       column the table exists for. */
    .map((r, i) => (i === 0 ? { ...r, carriedIn: 0 } : r));
}
