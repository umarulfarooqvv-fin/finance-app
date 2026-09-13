import 'server-only';
import { insert, select, update, logEvent } from '@/lib/supabase';
import { parseUserAmount } from '@/lib/money';
import type { Actor } from '@/lib/auth';
import type { IncomeInput } from '@/lib/validation';
import type { Tables, TablesInsert } from '@/types/database';

/* ===========================================================================
   Writing income.

   The mirror of lib/transactions.ts, and deliberately so: income was the one
   kind of row with no write path at all. It could arrive from the Shortcut
   and from the sheet importer, but nothing in the app could add, correct or
   remove one — a mistyped salary figure could only be fixed in the database.

   The id is content-derived for the same reason it is on the spending side: a
   Shortcut that retries over a flaky connection must upsert the same row, not
   post a second salary. The route previously used Math.random() here, which
   made every retry a new row.
   =========================================================================== */

export type IncomeRow = Tables<'income'>;
export type NewIncomeRow = TablesInsert<'income'>;

/** Stable id from an idempotency key the client mints once per dialog. */
export async function incomeIdFromKey(clientKey: string): Promise<string> {
  return hashed(`pfm-income:${clientKey}`, 24);
}

/**
 * Stable id from the row's own content.
 *
 * Used by the ingest endpoint, where there is no client key to rely on. Two
 * genuinely identical entries on the same second collapse to one row, which
 * is the right trade: a duplicated salary is far worse than a lost duplicate
 * that can be re-entered with a remark.
 */
export async function incomeIdFromContent(parts: (string | number | null)[]): Promise<string> {
  return hashed(parts.join('|'), 16);
}

async function hashed(input: string, length: number): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `inc-${hex.slice(0, length)}`;
}

/** Turn validated input into the row shape. Validation must already have passed. */
export function buildIncomeRow(input: IncomeInput, id: string): NewIncomeRow {
  const parsed = parseUserAmount(input.amount);
  if (!parsed.ok) throw new Error('buildIncomeRow called with an unvalidated amount');

  const source = input.source.trim();
  const account = input.account.trim();

  return {
    id,
    ts: input.ts,
    amount: parsed.amount,
    source,
    account,
    remarks: (input.remarks ?? '').trim(),
    // Flagged when the row cannot be attributed, so it surfaces instead of
    // quietly inflating a total that no account can account for.
    needs_review: !source || !account,
    deleted: false,
  };
}

async function fetchRow(id: string): Promise<IncomeRow | null> {
  const rows = await select('income', { filters: { id: `eq.${id}` }, limit: 1 });
  return rows[0] ?? null;
}

function auditable(row: Partial<IncomeRow> | Partial<NewIncomeRow> | null) {
  if (!row) return null;
  return {
    ts: row.ts, amount: row.amount, source: row.source,
    account: row.account, remarks: row.remarks, deleted: row.deleted,
  };
}

export type CreateIncomeResult = { id: string; duplicate: boolean };

export async function createIncome(
  input: IncomeInput & { clientKey: string },
  ctx: Actor,
): Promise<CreateIncomeResult> {
  const id = await incomeIdFromKey(input.clientKey);

  // A repeat submission resolves to the same id. Report it rather than
  // writing again, so the UI can say "already saved".
  const existing = await fetchRow(id);
  if (existing) return { id, duplicate: true };

  const row = buildIncomeRow(input, id);
  await insert('income', [row], { upsert: true });
  await logEvent('income.create', { id, by: ctx.actor, via: ctx.via, after: auditable(row) });
  return { id, duplicate: false };
}

export async function updateIncome(
  id: string,
  input: IncomeInput,
  ctx: Actor,
): Promise<{ id: string }> {
  const before = await fetchRow(id);
  if (!before) throw new Error('That income entry no longer exists.');
  if (before.deleted) throw new Error('That income entry has been deleted.');

  const next = buildIncomeRow(input, id);
  await update('income', { id: `eq.${id}` }, {
    ts: next.ts,
    amount: next.amount,
    source: next.source,
    account: next.account,
    remarks: next.remarks,
    needs_review: next.needs_review,
  });

  await logEvent('income.update', {
    id, by: ctx.actor, via: ctx.via, before: auditable(before), after: auditable(next),
  });
  return { id };
}

/** Soft delete, like every other financial row: history is never destroyed. */
export async function deleteIncome(id: string, ctx: Actor): Promise<{ id: string }> {
  const before = await fetchRow(id);
  if (!before) throw new Error('That income entry no longer exists.');
  if (before.deleted) return { id };

  await update('income', { id: `eq.${id}` }, { deleted: true });
  await logEvent('income.delete', { id, by: ctx.actor, via: ctx.via, before: auditable(before) });
  return { id };
}

export async function restoreIncome(id: string, ctx: Actor): Promise<{ id: string }> {
  const before = await fetchRow(id);
  if (!before) throw new Error('That income entry no longer exists.');
  await update('income', { id: `eq.${id}` }, { deleted: false });
  await logEvent('income.restore', { id, by: ctx.actor, via: ctx.via });
  return { id };
}
