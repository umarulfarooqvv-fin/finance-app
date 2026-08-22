import { round2 } from '@/lib/analytics';
import { endOfDay, type Day, type Instant } from '@/lib/time';
import type { Snapshot } from '@/lib/types';

/* ===========================================================================
   Credit Taken (spec §3.7) — money Farooq owes to people, as opposed to the
   card debt he owes to banks.

   Nothing in the transaction log marks a borrowing: money arriving as a loan
   looks exactly like any other inflow. So these are entered by hand and live
   in app_config, with repayments recorded against them.
   =========================================================================== */

export type Debt = {
  id: string;
  person: string;
  principal: number;
  /** When the money was borrowed. */
  takenOn: Day;
  note?: string;
  /** Optional agreed repayment date. */
  dueOn?: Day | null;
};

export type DebtPayment = {
  id: string;
  debtId: string;
  amount: number;
  paidOn: Day;
  note?: string;
};

export type DebtBalance = Debt & {
  repaid: number;
  balance: number;
  settled: boolean;
  payments: DebtPayment[];
};

export type DebtLedger = {
  debts: DebtBalance[];
  totalBorrowed: number;
  totalRepaid: number;
  totalOutstanding: number;
};

function readDebts(snapshot: Snapshot): Debt[] {
  const raw = snapshot.config['debts'];
  return Array.isArray(raw) ? (raw as Debt[]).filter((d) => d?.id && d.principal > 0) : [];
}

function readPayments(snapshot: Snapshot): DebtPayment[] {
  const raw = snapshot.config['debt_payments'];
  return Array.isArray(raw) ? (raw as DebtPayment[]).filter((p) => p?.debtId && p.amount > 0) : [];
}

/**
 * Balances as of a day. `asOf` makes the ledger date-aware so the net-worth
 * trend can reconstruct what was owed at the end of any past month rather than
 * carrying today's figure backwards.
 */
export function debtLedger(snapshot: Snapshot, asOf?: Day): DebtLedger {
  const bound = asOf ? endOfDay(asOf) : null;
  const within = (day: Day) => !bound || `${day}T00:00:00` <= bound;

  const payments = readPayments(snapshot).filter((p) => within(p.paidOn));
  const byDebt = new Map<string, DebtPayment[]>();
  for (const p of payments) {
    const list = byDebt.get(p.debtId) ?? [];
    list.push(p);
    byDebt.set(p.debtId, list);
  }

  const debts: DebtBalance[] = readDebts(snapshot)
    .filter((d) => within(d.takenOn))
    .map((d) => {
      const own = (byDebt.get(d.id) ?? []).sort((a, b) => a.paidOn.localeCompare(b.paidOn));
      const repaid = round2(own.reduce((a, p) => a + p.amount, 0));
      // Overpayment settles the debt; it never becomes money owed back.
      const balance = round2(Math.max(0, d.principal - repaid));
      return { ...d, repaid, balance, settled: balance <= 0.005, payments: own };
    })
    .sort((a, b) => b.balance - a.balance || a.person.localeCompare(b.person));

  return {
    debts,
    totalBorrowed: round2(debts.reduce((a, d) => a + d.principal, 0)),
    totalRepaid: round2(debts.reduce((a, d) => a + d.repaid, 0)),
    totalOutstanding: round2(debts.reduce((a, d) => a + d.balance, 0)),
  };
}

/** What was still owed on a given day — used by the net-worth trend. */
export function debtsOutstandingAt(snapshot: Snapshot, day: Day): number {
  return debtLedger(snapshot, day).totalOutstanding;
}

export type { Instant };
