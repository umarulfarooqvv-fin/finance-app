import { ALL_METHODS } from '@/lib/types';
import type { Transaction } from '@/lib/types';

/* ===========================================================================
   Paying a card's bill in two taps: "Mark as paid", then which account paid.

   A bill payment is an ordinary entry — method = the account the money left,
   category = the card it landed on (lib/classify reads that pair as
   `card_payment`, debt-). Nothing new is stored; the statement view then
   applies it to the bill (lib/statement: a payment after the statement date
   clears the bill first).

   The account is asked AFTER the tap, offered in the order this card has
   actually been paid from — the last one first, already chosen — so the usual
   case is "Mark as paid", "Paid from Fi".

   Pure: transactions in, a list out.
   =========================================================================== */

/** Accounts that can pay `card`, the ones it was paid from most recently first. */
export function billPayers(transactions: Transaction[], card: string): string[] {
  const used: string[] = [];
  const paid = transactions
    .filter((t) => !t.deleted && t.ts && t.kind === 'card_payment' && t.cardAffected === card && t.method.trim())
    .sort((a, b) => (a.ts! < b.ts! ? 1 : -1));
  for (const t of paid) if (!used.includes(t.method) && t.method !== card) used.push(t.method);
  // Everything else that can pay a card, in the app's own order. A card
  // cannot pay its own bill (lib/classify refuses that pair).
  const rest = (ALL_METHODS as readonly string[]).filter((m) => m !== card && !used.includes(m));
  return [...used.filter((m) => (ALL_METHODS as readonly string[]).includes(m)), ...rest];
}

/** The entry's description. */
export const billRemarks = (card: string) => `${card} bill`;
