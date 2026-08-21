import { creditLedger } from './credit.ts';
import { cycleFor, daysUntilDue, dueStatus, type Cycle, type DueStatus } from './cycles.ts';
import { dayOf, endOfDay, startOfDay, type Day, type Instant } from './time.ts';
import type { Card, Snapshot, Transaction } from './types.ts';

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
  creditByCard: Record<string, number> = {},
): StatementRow {
  const cycle = cycleFor(card, today);
  const now = endOfDay(today);
  const stmtEnd = endOfDay(cycle.statementEnd);
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

  for (const t of cardRows(snapshot, card, now)) {
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

  // True exclusion: only lending that has NOT been paid back is removed.
  const creditOutstanding = creditByCard[card.name] ?? 0;
  const remainingDueExcl = Math.max(0, remainingDueBill - creditOutstanding);
  const totalDebtExcl = totalDebtLive - creditOutstanding;

  const daysLeft = daysUntilDue(cycle, today);

  return {
    card: card.name,
    color: card.color,
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
  const rows = snapshot.cards
    .filter((c) => c.active)
    .map((c) => cardStatement(snapshot, c, today, credit.outstandingByCard))
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
  const row = cardStatement(snapshot, card, today, credit.outstandingByCard);
  const stmtEnd = endOfDay(row.cycle.statementEnd);
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
