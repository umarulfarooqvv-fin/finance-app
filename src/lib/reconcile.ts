import { boundaryFor, cycleFor, type CycleOverrides } from '@/lib/cycles';
import { round2 } from '@/lib/money';
import { addDays, endOfDay, startOfDay, type Day, type Instant } from '@/lib/time';
import type { Card, Snapshot, StatementBoundary, Transaction } from '@/lib/types';

/* ===========================================================================
   Statement reconciliation — working the cut-off out instead of guessing it.

   The problem this solves, in the user's words: some months the bill date's
   own spending appears on that statement, and some months it does not. That
   is not inconsistency in the data, it is the bank generating the statement at
   some moment during the bill date. Anything that posted after that moment
   rolls to the next one.

   A per-card flag cannot express "it varies". A per-cycle flag can, but it
   asks the user to KNOW which way a given month went, which they only know by
   comparing against the bank's own figure.

   So this goes the other way round. You enter the one number you can read
   straight off the statement — the closing balance the bank billed — and the
   reconciler computes the total under BOTH boundaries and reports which one
   the bank used. That turns an unanswerable question into an observation.

   When neither boundary reproduces the figure, that is the more valuable
   answer: something else is wrong — a missing transaction, a wrong amount, a
   fee nobody recorded — and the gap is reported rather than papered over by
   picking the closer of two wrong numbers.
   =========================================================================== */

export type BoundaryVerdict =
  /** Exactly one boundary reproduces the bank's figure. */
  | { kind: 'resolved'; boundary: StatementBoundary; total: number }
  /** Both give the same total — no transaction sits on the bill date. */
  | { kind: 'indifferent'; total: number }
  /** Neither matches. The difference is real and needs explaining. */
  | { kind: 'unexplained'; inclusive: number; exclusive: number; shortfall: number };

export type CycleReconciliation = {
  card: string;
  statementDate: Day;
  /** What the bank billed, as recorded by the user. */
  actual: number;
  /** Totals the engine computes under each rule. */
  inclusive: number;
  exclusive: number;
  /** Which boundary is currently in force for this cycle. */
  current: StatementBoundary;
  verdict: BoundaryVerdict;
  /** The rows that sit exactly on the bill date — the ones in dispute. */
  onBoundary: { id: string; ts: Instant; amount: number; remarks: string; direction: string }[];
};

/** Rows that count toward a card's balance, within its tracked window. */
function cardRows(snapshot: Snapshot, card: Card, upTo: Instant): Transaction[] {
  const floor = card.openingDate ? startOfDay(card.openingDate) : null;
  return snapshot.transactions.filter(
    (t) =>
      !t.deleted &&
      t.cardAffected === card.name &&
      t.amount != null &&
      t.ts != null &&
      t.ts <= upTo &&
      (floor === null || t.ts >= floor),
  );
}

/**
 * The closing balance this card would show for the statement generated on
 * `statementDate`, under one boundary rule.
 *
 * This mirrors `billedClosing` in statement.ts: the opening balance carried in,
 * plus everything charged up to the cut-off, less everything paid up to it.
 */
export function closingBalanceUnder(
  snapshot: Snapshot,
  card: Card,
  statementDate: Day,
  boundary: StatementBoundary,
): number {
  const cutOff = endOfDay(boundary === 'inclusive' ? statementDate : addDays(statementDate, -1));
  const rows = cardRows(snapshot, card, cutOff);

  let charged = 0;
  let paid = 0;
  for (const t of rows) {
    if (t.cardDirection === 'debt+') charged += t.amount as number;
    else if (t.cardDirection === 'debt-') paid += t.amount as number;
  }
  return round2((card.openingBalance || 0) + charged - paid);
}

/** Charges and payments dated exactly on the statement date. */
export function rowsOnBoundary(snapshot: Snapshot, card: Card, statementDate: Day) {
  const lo = startOfDay(statementDate);
  const hi = endOfDay(statementDate);
  return snapshot.transactions
    .filter(
      (t) =>
        !t.deleted && t.cardAffected === card.name && t.amount != null &&
        t.ts != null && t.ts >= lo && t.ts <= hi,
    )
    .map((t) => ({
      id: t.id,
      ts: t.ts as Instant,
      amount: t.amount as number,
      remarks: t.remarks || t.category,
      direction: t.cardDirection === 'debt-' ? 'payment' : 'charge',
    }));
}

/**
 * Compare the engine against the bank for one statement.
 *
 * `actual` is the closing balance printed on the statement.
 */
export function reconcileCycle(
  snapshot: Snapshot,
  card: Card,
  statementDate: Day,
  actual: number,
  overrides: CycleOverrides = {},
): CycleReconciliation {
  const inclusive = closingBalanceUnder(snapshot, card, statementDate, 'inclusive');
  const exclusive = closingBalanceUnder(snapshot, card, statementDate, 'exclusive');
  const target = round2(actual);

  // A paisa of slack: the bank rounds too, and chasing the last hundredth of a
  // rupee would reject statements that are correct in every way that matters.
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

  let verdict: BoundaryVerdict;
  if (near(inclusive, exclusive)) {
    // Nothing was dated on the bill date, so the question does not arise.
    verdict = near(inclusive, target)
      ? { kind: 'indifferent', total: inclusive }
      : { kind: 'unexplained', inclusive, exclusive, shortfall: round2(target - inclusive) };
  } else if (near(inclusive, target)) {
    verdict = { kind: 'resolved', boundary: 'inclusive', total: inclusive };
  } else if (near(exclusive, target)) {
    verdict = { kind: 'resolved', boundary: 'exclusive', total: exclusive };
  } else {
    verdict = {
      kind: 'unexplained',
      inclusive,
      exclusive,
      // Measured against whichever rule is currently in force, since that is
      // the number the app is actually showing.
      shortfall: round2(
        target - (boundaryFor(card, statementDate, overrides) === 'inclusive' ? inclusive : exclusive),
      ),
    };
  }

  return {
    card: card.name,
    statementDate,
    actual: target,
    inclusive,
    exclusive,
    current: boundaryFor(card, statementDate, overrides),
    verdict,
    onBoundary: rowsOnBoundary(snapshot, card, statementDate),
  };
}

/**
 * Reconcile every statement for which an actual figure has been recorded.
 * Used by the card page to show which cycles agree with the bank.
 */
export function reconcileRecorded(snapshot: Snapshot, card: Card): CycleReconciliation[] {
  const overrides = (snapshot.config['statement_cycles'] as CycleOverrides | undefined) ?? {};
  const forCard = overrides[card.name] ?? {};

  return Object.entries(forCard)
    .filter(([, o]) => typeof o.actual === 'number')
    .map(([statementDate, o]) =>
      reconcileCycle(snapshot, card, statementDate as Day, o.actual as number, overrides),
    )
    .sort((a, b) => (a.statementDate < b.statementDate ? 1 : -1));
}

/** The statement dates worth offering to reconcile: the recent closed cycles. */
export function recentStatementDates(card: Card, today: Day, count = 6): Day[] {
  const out: Day[] = [];
  let cursor = today;
  for (let i = 0; i < count; i++) {
    const c = cycleFor(card, cursor);
    out.push(c.statementEnd);
    cursor = addDays(c.cycleStart, -1);
  }
  return out;
}
