import 'server-only';
import { updateConfigKey } from '@/lib/config';
import { logEvent } from '@/lib/supabase';
import { DEFAULT_ACCOUNTS, DEFAULT_CARDS } from '@/lib/defaults';
import { getSnapshot } from '@/lib/snapshot';
import type { Actor } from '@/lib/auth';
import type { Account, Card, StatementBoundary } from '@/lib/types';
import { normaliseAmount, normaliseWhole } from '@/lib/validation';
import type { AccountSettingsInput, CardSettingsInput } from '@/lib/validation';

/* ===========================================================================
   Saving the configuration every other figure is computed from.

   Two things make this more delicate than saving a transaction.

   A CARD'S SETTINGS REWRITE HISTORY. Changing a bill date moves every charge
   on that card onto a different statement, for every month ever recorded.
   That is intended — it is how a wrong setting gets corrected — but it is why
   the previous values go into the audit log: a figure that moves can then be
   traced to the edit that moved it, rather than looking like drift.

   THE WRITE IS READ-MODIFY-WRITE ON THE STORED KEY, not on the snapshot. The
   snapshot is a cache with a throttled freshness check, so computing the next
   list from it could quietly revert a change made moments earlier. The list
   that gets modified is read from the database inside the same call.

   Both lists merge over the audited defaults by name (see mergeCards and
   mergeAccounts in snapshot.ts), so storing only the entries that were
   actually edited is safe and a re-deploy cannot reset the rest.
   =========================================================================== */

export async function saveCardSettings(input: CardSettingsInput, actor: Actor): Promise<Card> {
  const snap = await getSnapshot();
  const before = snap.cards.find((c) => c.name === input.name);
  if (!before) throw new Error(`No card named ${input.name}.`);

  const next: Card = {
    ...before,
    billDate: normaliseWhole(input.billDate, before.billDate),
    dueDay:
      input.dueDay === '' || input.dueDay === null || input.dueDay === undefined
        ? null
        : normaliseWhole(input.dueDay, before.dueDay ?? 1),
    dueCycle: input.dueCycle === 'next' ? 'next' : 'same',
    graceDays: normaliseWhole(input.graceDays, before.graceDays),
    creditLimit: normaliseAmount(input.creditLimit),
    openingBalance: normaliseAmount(input.openingBalance),
    openingDate: (input.openingDate ?? '').trim() || null,
    statementBoundary:
      input.statementBoundary === 'exclusive'
        ? ('exclusive' satisfies StatementBoundary)
        : ('inclusive' satisfies StatementBoundary),
    active: Boolean(input.active),
  };

  await upsertByName('cards', DEFAULT_CARDS, next, (c) => c.name);
  await logEvent('settings.card', {
    card: next.name,
    by: actor.actor,
    via: actor.via,
    changed: changedFields(before, next),
  });
  return next;
}

export async function saveAccountSettings(
  input: AccountSettingsInput,
  actor: Actor,
): Promise<Account> {
  const snap = await getSnapshot();
  const before = snap.accounts.find((a) => a.name === input.name);
  if (!before) throw new Error(`No account named ${input.name}.`);

  const next: Account = {
    ...before,
    kind: input.kind === 'cash' ? 'cash' : 'bank',
    openingBalance: normaliseAmount(input.openingBalance),
    since: (input.since ?? '').trim() || null,
    active: Boolean(input.active),
  };

  await upsertByName('accounts', DEFAULT_ACCOUNTS, next, (a) => a.name);
  await logEvent('settings.account', {
    account: next.name,
    by: actor.actor,
    via: actor.via,
    changed: changedFields(before, next),
  });
  return next;
}

/**
 * Replace (or add) one named entry in a stored config list.
 *
 * `updateConfigKey` reads the key immediately before writing it, so this is a
 * genuine read-modify-write: another key being saved at the same time cannot
 * be erased, and a stale in-process snapshot cannot be written back.
 */
async function upsertByName<T>(
  key: 'cards' | 'accounts',
  defaults: readonly T[],
  next: T,
  nameOf: (item: T) => string,
): Promise<void> {
  const name = nameOf(next);
  await updateConfigKey<Record<string, unknown>>(key, (current) => {
    const stored = Array.isArray(current) ? (current as T[]) : [];
    /* Nothing stored yet: seed from the defaults so the very first save
       records a complete, self-describing list rather than a lone entry whose
       meaning depends on what the code happened to default to that day. */
    const base = stored.length ? stored : [...defaults];
    const found = base.some((item) => nameOf(item) === name);
    const list = found ? base.map((item) => (nameOf(item) === name ? next : item)) : [...base, next];
    return list as unknown as Record<string, unknown>;
  });
}

/** Which fields actually moved, for the audit line. */
function changedFields<T extends object>(before: T, after: T): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (before[k] !== after[k]) out[String(k)] = [before[k], after[k]];
  }
  return out;
}
