import type { Day, Instant } from '@/lib/time';

/* ===========================================================================
   Core domain types.

   The vocabulary here is deliberately small. Every screen in the app is a
   projection of `Snapshot` — there is no other source of truth in the process.
   =========================================================================== */

/** Credit cards. Debt accrues on these; everything else settles immediately. */
export const CARD_NAMES = ['Edge', 'One Card', 'ICICI', 'Coral', 'Scapia', 'Super Money'] as const;
export type CardName = (typeof CARD_NAMES)[number];

/** Money sources that are not credit cards — no debt, money leaves at once.
    `Perks` is reward points; it settles a card bill without costing cash. */
export const BANK_METHODS = ['Fi', 'Jupiter', 'Cash', 'Perks', 'SBI', 'RBL', 'Canara', 'IPPB'] as const;
export type BankMethod = (typeof BANK_METHODS)[number];

export type Method = CardName | BankMethod | (string & {});

/** Categories that represent Farooq's own consumption. */
export const SPEND_CATEGORIES = [
  'Family', 'Food', 'Fuel', 'Personal', 'Gifts/Donations', 'Maintenance',
  'Entertainment', 'Surcharge', 'Taxes', 'Medicine', 'Groceries', 'Credit Return',
] as const;

/** Categories that move money without being consumption. */
export const TRANSFER_CATEGORIES = ['Credit Given', 'Credit Card', 'Investment', 'Savings'] as const;

export const ALL_CATEGORIES = [...SPEND_CATEGORIES, 'Credit Given', ...CARD_NAMES] as const;
export const ALL_METHODS = [...BANK_METHODS, ...CARD_NAMES] as const;

export function isCard(m: string): m is CardName {
  return (CARD_NAMES as readonly string[]).includes(m);
}

/**
 * What a row means, once classified.
 *  - spend         money consumed
 *  - card_payment  a bill paid TO a card (reduces that card's debt)
 *  - credit_given  money lent to a person; a real outflow, but excludable
 *                  from "my spending" views
 *  - investment    moved into an instrument; a transfer, never spend
 *  - emi           an instalment row that carries an n/m counter
 *  - unknown       unclassifiable; surfaced for review, never silently counted
 */
export type TxKind = 'spend' | 'card_payment' | 'credit_given' | 'investment' | 'emi' | 'unknown';

/** Which way a row moves a card's balance. */
export type CardDirection = 'debt+' | 'debt-';

/** Whether the statement date itself counts as part of that statement. */
export type StatementBoundary = 'inclusive' | 'exclusive';

export type EmiTag = { n: number; m: number };

export type Tags = {
  trip?: string;
  cirqle?: boolean;
  emi?: EmiTag | true;
  emiName?: string;
  emiComponent?: 'principal' | 'surcharge' | 'tax';
  cleared?: boolean;
  person?: string;
};

export type Transaction = {
  id: string;
  /** null when the source row had an unparseable timestamp; flagged for review. */
  ts: Instant | null;
  amount: number | null;
  method: Method;
  category: string;
  remarks: string;
  kind: TxKind;
  cardAffected: CardName | null;
  cardDirection: CardDirection | null;
  tags: Tags;
  verified: boolean;
  needsReview: boolean;
  deleted: boolean;
  source: string;
};

export type Income = {
  id: string;
  ts: Instant | null;
  amount: number | null;
  source: string;
  account: string;
  remarks: string;
  needsReview: boolean;
  deleted: boolean;
};

/** Per-card configuration. Drives the whole statement engine. */
export type Card = {
  name: CardName | string;
  /** Day of month the statement is generated. */
  billDate: number;
  /** Fallback when dueDay is absent: dueDate = statementEnd + graceDays. */
  graceDays: number;
  /** Real due day-of-month from the card's own settings, when known. */
  dueDay: number | null;
  /** Whether dueDay falls in the statement's month or the next one. */
  dueCycle: 'same' | 'next';
  creditLimit: number;
  /**
   * Where a transaction dated ON the statement date belongs.
   *
   *   inclusive — it is on THIS statement (the common case, and the default)
   *   exclusive — the statement was cut before it, so it rolls to the next one
   *
   * Banks generate a statement at some moment during the bill date, so whether
   * that day's spending made it in genuinely varies month to month. This is
   * the card's usual behaviour; a single cycle can override it, and the
   * reconciler can work it out from the amount the bank actually billed.
   */
  statementBoundary: StatementBoundary;
  /** Debt carried on `openingDate`, standing in for untracked history. */
  openingBalance: number;
  openingDate: Day | null;
  /** Categorical palette slot 1-6, resolved to a CSS variable at render time
      so the colour follows the theme. Storing a hex here would freeze one
      theme's value into the config. */
  slot: number;
  active: boolean;
};

/** A bank or cash account. Balance = opening + income - outflows since `since`. */
export type Account = {
  name: string;
  kind: 'bank' | 'cash';
  openingBalance: number;
  since: Day | null;
  active: boolean;
};

/**
 * Everything the engine needs, loaded once per request generation and shared
 * by every computation. Pure in, pure out — no module in `domain/` may reach
 * for a network, a file, or the clock on its own.
 */
export type Snapshot = {
  transactions: Transaction[];
  income: Income[];
  cards: Card[];
  accounts: Account[];
  config: Record<string, unknown>;
  /** The store's monotonic version this snapshot was built from. */
  version: number;
  /** When it was built (IST wall clock). */
  loadedAt: Instant;
};
