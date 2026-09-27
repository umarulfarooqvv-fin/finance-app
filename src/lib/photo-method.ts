import { parseImport } from '@/lib/import-parse';
import { resolveMethod, type BankMethods } from '@/lib/bank-methods';
import { entryFromReading } from '@/lib/capture-entry';
import { daysBetween, dayOf } from '@/lib/time';

/* ===========================================================================
   Does the photo attached to an entry say it was paid from a different card?

   A payment is logged as "Fi" out of habit while the UPI screen attached to it
   says "Federal CC XX16" — Scapia. Left alone, that charge sits on the wrong
   card: Fi's balance understated, Scapia's bill short, and nothing on either
   screen looks wrong.

   This is the one place the app lets a model's reading CHANGE an entry rather
   than propose one, so every condition below exists to make "this photo is
   of this payment, and it names this card" certain rather than likely:

     - the entry has not been reconciled against a statement — a statement's
       word on which card beats a screenshot's
     - the photo holds exactly one payment
     - its amount is the entry's, to the paisa — the same payment, not a
       similar one
     - its date is the entry's day or the day before (logged after midnight)
     - its method is a BANK LABEL WITH AN ACCOUNT NUMBER that the ledger's own
       mapping resolves to exactly one card. Never a card name the model
       wrote itself: that is how "RBL" once appeared for a Federal card.

   Anything short of all of that leaves the entry alone. The caller shows
   every change it makes, with an undo.
   =========================================================================== */

export type EntryFacts = { ts: string; amount: number; method: string; verified: boolean };

export type MethodVerdict =
  | { kind: 'correct'; to: string; label: string }
  | { kind: 'keep'; reason: string };

export function methodFromPhoto(
  reading: string,
  entry: EntryFacts,
  bankMethods: BankMethods,
): MethodVerdict {
  if (entry.verified) return { kind: 'keep', reason: 'reconciled against a statement' };

  const { rows } = parseImport(reading, { bankMethods });
  if (rows.length !== 1) return { kind: 'keep', reason: `the photo holds ${rows.length} payments` };
  const row = rows[0]!;

  if (Math.round(row.amount * 100) !== Math.round(entry.amount * 100)) {
    return { kind: 'keep', reason: 'the amount differs, so it may be a different payment' };
  }

  // Dated through the same rules the inbox uses — an invented year repaired,
  // a date after the entry refused — then held to the entry's own day.
  const dated = entryFromReading(reading, entry.ts, bankMethods);
  if (dated.kind !== 'one' || dated.dateDoubtful) return { kind: 'keep', reason: 'the date could not be trusted' };
  const gap = daysBetween(dayOf(dated.draft.ts), dayOf(entry.ts));
  if (gap < 0 || gap > 1) return { kind: 'keep', reason: 'the photo is from another day' };

  const label = row.methodRaw;
  if (!/\d{2,}/.test(label)) return { kind: 'keep', reason: 'no account number on the photo' };
  // A label that is itself one of the app's names was chosen, not printed.
  if (resolveMethod(label, {})) return { kind: 'keep', reason: 'not a bank label' };
  const to = resolveMethod(label, bankMethods);
  if (!to) return { kind: 'keep', reason: `"${label}" is not in the bank-label mapping` };
  if (to === entry.method) return { kind: 'keep', reason: 'already right' };

  return { kind: 'correct', to, label };
}
