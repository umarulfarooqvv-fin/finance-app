import 'server-only';
import type { Actor } from '@/lib/auth';
import { classify } from '@/lib/classify';
import { parseUserAmount } from '@/lib/money';
import { insert, logEvent, select, update } from '@/lib/supabase';
import { nowIST } from '@/lib/time';
import type { TransactionInput } from '@/lib/validation';
import type { Tables, TablesInsert } from '@/types/database';

/* ===========================================================================
   Transaction writes.

   Three properties this module is built to guarantee:

   1. IDEMPOTENCE. Every create carries a client-generated key, and the row id
      is derived from it. Submitting twice — a double tap, a retried request,
      a flaky connection — writes the same id twice, which upserts. It cannot
      produce two rows. This is deliberately NOT content-derived: two genuinely
      identical ₹10 purchases on one day are real and must both be recordable.
      (The live data contains exactly such a pair, from the sheet import.)

   2. DERIVED FIELDS ARE NEVER TRUSTED FROM THE CLIENT. kind, card_affected,
      card_direction and tags are recomputed here from method/category/remarks.
      A client that posted `kind: 'card_payment'` could otherwise erase debt.

   3. EVERY CHANGE IS AUDITED, with the before-state. A finance app that cannot
      say what a row used to be cannot answer "why did my balance change?".
   =========================================================================== */

/* The row shapes come from the generated schema rather than being restated
   here. A column renamed in Postgres then becomes a compile error at every
   call site, instead of an undefined discovered at runtime. */
export type TransactionRow = Tables<'transactions'>;
export type NewTransactionRow = TablesInsert<'transactions'>;

/** Stable id from the client's idempotency key. */
export async function idFromKey(clientKey: string): Promise<string> {
  const data = new TextEncoder().encode(`pfm-entry:${clientKey}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `tx-${hex.slice(0, 24)}`;
}

/**
 * Turn validated input into the row shape, deriving everything derivable.
 * Validation must already have passed — this trusts the amount parses.
 */
export function buildRow(
  input: TransactionInput,
  id: string,
  source: string,
): NewTransactionRow {
  const parsed = parseUserAmount(input.amount);
  if (!parsed.ok) throw new Error('buildRow called with an unvalidated amount');

  const method = input.method.trim();
  const category = input.category.trim();
  const remarks = (input.remarks ?? '').trim();
  const cls = classify({ method, category, remarks });

  return {
    id,
    ts: input.ts,
    amount: parsed.amount,
    method,
    category,
    remarks,
    // Derived server-side, never accepted from the caller.
    kind: cls.kind,
    card_affected: cls.cardAffected,
    card_direction: cls.cardDirection,
    // `tags` is jsonb; the generated Json type is what the column accepts.
    tags: cls.tags as TablesInsert<'transactions'>['tags'],
    verified: false,
    needs_review: cls.kind === 'unknown',
    deleted: false,
    source,
  };
}

async function fetchRow(id: string): Promise<TransactionRow | null> {
  const rows = await select('transactions', { filters: { id: `eq.${id}` }, limit: 1 });
  return rows[0] ?? null;
}

/** Fields worth recording in the audit trail. */
function auditable(row: Partial<TransactionRow> | Partial<NewTransactionRow> | null) {
  if (!row) return null;
  return {
    ts: row.ts, amount: row.amount, method: row.method,
    category: row.category, remarks: row.remarks, deleted: row.deleted,
  };
}

export type CreateResult = { id: string; duplicate: boolean };

export async function createTransaction(
  input: TransactionInput & { clientKey: string },
  ctx: Actor,
  source = 'app',
): Promise<CreateResult> {
  const id = await idFromKey(input.clientKey);

  // A repeat submission resolves to the same id. Report it rather than
  // silently writing again, so the UI can say "already saved" instead of
  // implying a second entry was created.
  const existing = await fetchRow(id);
  if (existing) return { id, duplicate: true };

  const row = buildRow(input, id, source);
  await insert('transactions', [row], { upsert: true });
  await logEvent('transaction.create', { id, by: ctx.actor, via: ctx.via, after: auditable(row) });
  return { id, duplicate: false };
}

export type EditableFields = Pick<TransactionInput, 'amount' | 'method' | 'category' | 'remarks' | 'ts'>;

export async function updateTransaction(
  id: string,
  input: EditableFields,
  ctx: Actor,
): Promise<{ id: string }> {
  const before = await fetchRow(id);
  if (!before) throw new Error('That entry no longer exists.');
  if (before.deleted) throw new Error('That entry has been deleted.');

  // Rebuild from scratch so the derived fields cannot drift out of step with
  // the values they are derived from.
  // `source` is nullable in the schema; an edit keeps the original provenance
  // and falls back to 'app' only if history never recorded one.
  const next = buildRow(input, id, before.source ?? 'app');

  await update('transactions', { id: `eq.${id}` }, {
    ts: next.ts,
    amount: next.amount,
    method: next.method,
    category: next.category,
    remarks: next.remarks,
    kind: next.kind,
    card_affected: next.card_affected,
    card_direction: next.card_direction,
    tags: next.tags,
    needs_review: next.needs_review,
    // An edited row is no longer the row that was reconciled against the
    // statement, so the tick is cleared rather than silently carried over.
    verified: false,
  });

  await logEvent('transaction.update', {
    id, by: ctx.actor, via: ctx.via,
    before: auditable(before), after: auditable(next),
  });
  return { id };
}

/**
 * Soft delete. Financial history is never destroyed — the row stays, flagged,
 * so an audit can still explain a past balance. Every read already filters on
 * `deleted`.
 */
export async function deleteTransaction(id: string, ctx: Actor): Promise<{ id: string }> {
  const before = await fetchRow(id);
  if (!before) throw new Error('That entry no longer exists.');
  if (before.deleted) return { id }; // already gone; deleting twice is a no-op

  await update('transactions', { id: `eq.${id}` }, { deleted: true });
  await logEvent('transaction.delete', { id, by: ctx.actor, via: ctx.via, before: auditable(before) });
  return { id };
}

export async function restoreTransaction(id: string, ctx: Actor): Promise<{ id: string }> {
  const before = await fetchRow(id);
  if (!before) throw new Error('That entry no longer exists.');
  await update('transactions', { id: `eq.${id}` }, { deleted: false });
  await logEvent('transaction.restore', { id, by: ctx.actor, via: ctx.via });
  return { id };
}

/** Reconciliation tick: "I matched this against the bank statement." */
export async function setVerified(
  id: string,
  verified: boolean,
  ctx: Actor,
): Promise<{ id: string; verified: boolean }> {
  const before = await fetchRow(id);
  if (!before) throw new Error('That entry no longer exists.');

  await update('transactions', { id: `eq.${id}` }, { verified });
  await logEvent('transaction.verify', { id, by: ctx.actor, via: ctx.via, verified });
  return { id, verified };
}

/** Current IST wall clock — the default date for a new entry. */
export function defaultEntryTimestamp(): string {
  return nowIST();
}
