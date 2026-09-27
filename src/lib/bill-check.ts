import { round2 } from '@/lib/money';
import type { StatementSummary } from '@/lib/statement-parse';

/* ===========================================================================
   The whole bill, bank against app, in four numbers.

   Matching lines answers "is every charge on this statement accounted for".
   It cannot answer "is the balance right", and that is the question a person
   actually has when the app says ₹18,346.92 and the bank says ₹18,426.83.

   A bill has four parts, and each disagreement has exactly one kind of cause:

     opening   — carried in from an EARLIER statement. Nothing on this one can
                 explain it; the fix is on the month where it first appears.
     charges   — a charge on the statement with no entry here, or the reverse.
     payments  — a payment or refund with no entry here: a surcharge waiver,
                 a merchant refund, a cashback credit.
     closing   — the sum of the three. Never a cause of its own.

   Seeing the four side by side turns "it's out by ₹79.91" into "₹85.81 came
   in from before, and a ₹5.90 refund is missing" — which is to say, into two
   things that can be fixed.

   Pure: the bank's summary box and the app's own cycle maths in, findings out.
   =========================================================================== */

export type BillFigures = {
  opening: number;
  charges: number;
  payments: number;
  closing: number;
};

/** App minus bank, per figure. Negative = the app has less than the bank. */
export type BillDiffs = BillFigures;

export type BillFinding =
  | { kind: 'agree' }
  | { kind: 'opening'; diff: number }
  | { kind: 'charges'; diff: number }
  | { kind: 'payments'; diff: number }
  /** The bank's own four figures do not add up — a fee or interest the
      statement charged outside its transaction list. */
  | { kind: 'bank-extra'; amount: number };

export type BillCheck = {
  bank: BillFigures;
  app: BillFigures;
  diff: BillDiffs;
  findings: BillFinding[];
};

/** A paisa is the smallest thing money can be off by; below it is rounding. */
const off = (n: number) => Math.abs(n) >= 0.005;

export function billCheck(summary: StatementSummary, app: BillFigures): BillCheck {
  const bank: BillFigures = {
    opening: summary.previousBalance,
    charges: summary.charges,
    payments: summary.payments,
    closing: summary.totalDue,
  };
  const diff: BillDiffs = {
    opening: round2(app.opening - bank.opening),
    charges: round2(app.charges - bank.charges),
    payments: round2(app.payments - bank.payments),
    closing: round2(app.closing - bank.closing),
  };

  const findings: BillFinding[] = [];
  // Ordered by where to look first: an inherited error is the one that no
  // amount of work on THIS statement's lines will ever find.
  if (off(diff.opening)) findings.push({ kind: 'opening', diff: diff.opening });
  if (off(diff.charges)) findings.push({ kind: 'charges', diff: diff.charges });
  if (off(diff.payments)) findings.push({ kind: 'payments', diff: diff.payments });

  const bankExtra = round2(bank.closing - (bank.opening + bank.charges - bank.payments));
  if (off(bankExtra)) findings.push({ kind: 'bank-extra', amount: bankExtra });

  if (findings.length === 0 && !off(diff.closing)) findings.push({ kind: 'agree' });
  return { bank, app, diff, findings };
}
