import { parseImport } from '@/lib/import-parse';
import { resolveMethod, type BankMethods } from '@/lib/bank-methods';
import { entryFromReading } from '@/lib/capture-entry';
import { foldForSearch } from '@/lib/search-text';
import { dayOf, secondsBetween } from '@/lib/time';

/* ===========================================================================
   What the photo attached to an entry says the entry got wrong.

   A payment is logged as "Fi" out of habit at 10:05 PM, while the UPI screen
   attached to it says "Federal CC XX16" — Scapia — at 5:44 PM. Both are
   wrong in the ledger: the charge sits on the wrong card, and possibly in the
   wrong statement if the real moment was on the other side of a bill date.

   This is the one place the app lets a model's reading CHANGE an entry rather
   than propose one, so it only proposes anything once the photo is certainly
   OF this payment:

     - the entry has not been reconciled against a statement — a statement's
       word beats a screenshot's
     - the photo holds exactly one payment
     - its amount is the entry's, to the paisa
     - its date passes the inbox's own rules: an invented year repaired, never
       after the entry, never more than 45 days before it

   Then, independently:

     CARD — only from a printed BANK LABEL WITH AN ACCOUNT NUMBER that the
       ledger's own mapping resolves to exactly one card. Never a card name
       the model chose: that is how "RBL" once appeared for a Federal card.

     TIME — the photo's moment, when it differs from the entry's by more than
       a few minutes (logging a minute after paying is not an error).

   AND BEFORE EITHER IS APPLIED, a duplicate check. If another entry on the
   photo's date has the same amount and the same card, category or a shared
   word in its description, this may be the same payment logged twice — the
   Add Spend Shortcut did exactly that for a week. Then nothing changes on its
   own: the question goes to the person.
   =========================================================================== */

export type EntryFacts = {
  ts: string;
  amount: number;
  method: string;
  verified: boolean;
  category?: string;
  remarks?: string;
};

/** Another live entry, to test for a duplicate. */
export type OtherEntry = {
  id: string;
  ts: string;
  amount: number;
  method: string;
  category: string;
  remarks: string;
};

export type PhotoProposal = {
  method?: { to: string; label: string };
  ts?: { to: string };
};

export type PhotoVerdict =
  | { kind: 'apply'; proposal: PhotoProposal }
  | { kind: 'ask'; proposal: PhotoProposal; duplicate: OtherEntry; why: string }
  | { kind: 'keep'; reason: string };

/** Moments closer than this are the same moment: logged just after paying. */
const SAME_MOMENT_SECONDS = 5 * 60;

const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'paid', 'payment', 'upi', 'bill']);
const words = (s: string) =>
  new Set(foldForSearch(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));

/** Why `other` looks like the same payment as the one photographed, or null. */
function sameness(entry: EntryFacts, method: string, other: OtherEntry): string | null {
  if (Math.round(other.amount * 100) !== Math.round(entry.amount * 100)) return null;
  if (other.method && other.method === method) return `same amount on ${method}`;
  if (entry.category && other.category && other.category === entry.category) {
    return `same amount and category (${other.category})`;
  }
  const mine = words(entry.remarks ?? '');
  for (const w of words(other.remarks)) if (mine.has(w)) return `same amount, and both mention "${w}"`;
  return null;
}

export function photoVerdict(
  reading: string,
  entry: EntryFacts,
  bankMethods: BankMethods,
  others: OtherEntry[] = [],
): PhotoVerdict {
  if (entry.verified) return { kind: 'keep', reason: 'reconciled against a statement' };

  const { rows } = parseImport(reading, { bankMethods });
  if (rows.length !== 1) return { kind: 'keep', reason: `the photo holds ${rows.length} payments` };
  const row = rows[0]!;

  if (Math.round(row.amount * 100) !== Math.round(entry.amount * 100)) {
    return { kind: 'keep', reason: 'the amount differs, so it may be a different payment' };
  }

  const dated = entryFromReading(reading, entry.ts, bankMethods);
  if (dated.kind !== 'one' || dated.dateDoubtful) return { kind: 'keep', reason: 'the date could not be trusted' };
  const photoTs = dated.draft.ts;

  const proposal: PhotoProposal = {};

  // CARD — a printed bank label with an account number, and nothing less.
  const label = row.methodRaw;
  const printed = /\d{2,}/.test(label) && !resolveMethod(label, {});
  const to = printed ? resolveMethod(label, bankMethods) : null;
  if (to && to !== entry.method) proposal.method = { to, label };

  // TIME — the photo's moment, if it is materially different.
  if (Math.abs(secondsBetween(entry.ts, photoTs)) > SAME_MOMENT_SECONDS) proposal.ts = { to: photoTs };

  // DUPLICATE — anything on the photo's date that looks like this payment.
  const method = proposal.method?.to ?? entry.method;
  const photoDay = dayOf(photoTs);
  for (const other of others) {
    if (dayOf(other.ts) !== photoDay) continue;
    const why = sameness(entry, method, other);
    if (why) return { kind: 'ask', proposal, duplicate: other, why };
  }

  if (!proposal.method && !proposal.ts) return { kind: 'keep', reason: 'already right' };
  return { kind: 'apply', proposal };
}
