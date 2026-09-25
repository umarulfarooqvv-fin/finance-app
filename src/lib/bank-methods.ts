import { foldForSearch } from '@/lib/search-text';
import { ALL_METHODS } from '@/lib/types';

/* ===========================================================================
   Which account a bank's own label means.

   A UPI history names the account the way the BANK does — "Federal 2788",
   "Utkarsh XX24", "CSB XX06" — and this ledger names it the way its owner
   does: Fi, Super Money, Edge. Nothing in either string hints at the other, so
   without a mapping every pasted row arrives with no method, and a row with no
   method lands on no card and no account.

   IT IS CONFIGURATION, NOT A CONSTANT. Accounts get opened and closed and
   re-pointed, and burying this in code would mean a deploy to record that a
   card moved bank. It lives in app_config beside the statement cycles and the
   subscriptions, and is read the same way.

   MATCHING IS EXACT ON THE FOLDED LABEL, with one deliberate widening: a
   trailing account number may be dropped, so "Federal 2788" still resolves
   when the mapping only knows "Federal". It is NOT fuzzy beyond that — two
   accounts at one bank are the common case here ("Federal 2788" is Fi while
   "Federal XX16" is Scapia), and a loose match would silently file a payment
   against the wrong card, which is the error nobody ever spots.
   =========================================================================== */

/** Bank label as printed → a method this app knows. */
export type BankMethods = Record<string, string>;

export function bankMethodsFrom(config: Record<string, unknown>): BankMethods {
  const raw = config['bank_methods'];
  if (!raw || typeof raw !== 'object') return {};

  const out: BankMethods = {};
  for (const [label, method] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof method !== 'string') continue;
    // A mapping pointing at a method the app no longer has is worse than no
    // mapping: it would fill a field with something the form then refuses.
    if (!(ALL_METHODS as readonly string[]).includes(method)) continue;
    if (label.trim()) out[label.trim()] = method;
  }
  return out;
}

/** "Federal 2788" → "Federal"; "CSB XX06" → "CSB". Empty when there is no tail. */
function withoutAccount(label: string): string {
  return label.replace(/\s*(?:XX)?[\dX]{2,}\s*$/i, '').trim();
}

/** "Federal CC XX16" → "Federal XX16": the words that say what KIND of account
    it is, which a UPI app prints and a mapping written by hand usually omits. */
function withoutKind(label: string): string {
  return label
    .replace(/\b(?:credit\s+card|debit\s+card|cc|dc|card|a\/c|acct|account|bank)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve what a paste wrote in the method column.
 *
 * Tried in order, most specific first:
 *   1. a method this app already knows, however it was capitalised
 *   2. the bank label exactly as mapped
 *   3. the bank label with words like "CC" or "Bank" dropped, account kept
 *   4. the bank label with its account number dropped
 *
 * Returns null rather than a guess. A wrong method moves money onto the wrong
 * card and nothing afterwards looks wrong, so "I do not know" has to be a
 * possible answer.
 */
export function resolveMethod(raw: string, mapping: BankMethods): string | null {
  const q = foldForSearch(raw);
  if (!q) return null;

  const own = (ALL_METHODS as readonly string[]).find((m) => foldForSearch(m) === q);
  if (own) return own;

  for (const [label, method] of Object.entries(mapping)) {
    if (foldForSearch(label) === q) return method;
  }

  /* A payment screen prints "Federal CC XX16" where the mapping says "Federal
     XX16" — the same card, described. Dropping the kind words from both sides
     still leaves the account number in the comparison, so two cards at one
     bank stay apart; and only a single answer counts, as below. */
  const plain = foldForSearch(withoutKind(raw));
  if (plain) {
    const kindHits = Object.entries(mapping).filter(
      ([label]) => foldForSearch(withoutKind(label)) === plain,
    );
    const kindMethods = new Set(kindHits.map(([, m]) => m));
    if (kindMethods.size === 1) return kindHits[0]![1];
  }

  /* Compared with the account number dropped from BOTH sides, so "Utkarsh"
     finds "Utkarsh XX24" and "CSB XX99" finds "CSB XX06". Not short-circuited
     when the query already has no number — that is the very case where only
     the mapping's side needs shortening. */
  const trimmed = foldForSearch(withoutAccount(raw));
  if (!trimmed) return null;

  /* Only when exactly ONE mapping shortens to this. Two accounts at one bank
     is the common case, and picking either would be a coin toss with money on
     it. */
  const hits = Object.entries(mapping).filter(
    ([label]) => foldForSearch(withoutAccount(label)) === trimmed,
  );
  const methods = new Set(hits.map(([, m]) => m));
  return methods.size === 1 ? hits[0]![1] : null;
}
