'use server';

import { guardedAction } from '@/lib/actions';
import { updateConfigKey } from '@/lib/config';
import { parseUserAmount } from '@/lib/money';
import { FAMILY_KEY, familyErrors, familyFrom } from '@/lib/family';
import type { FamilyConfig, FamilyGroup, FamilyMember } from '@/lib/family';
import type { FieldErrors } from '@/lib/action-result';

/* ===========================================================================
   The family page's writes: who is in the split, the cost groups, and the
   payments typed in for a brother. All in `family` in app_config; nothing
   here touches the ledger.

   Each is a read-modify-write of the whole key (updateConfigKey), so a
   payment added while the setup is being edited is not lost.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY.
   =========================================================================== */

const PATHS = ['/family'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The stored config, or the starting suggestion when nothing was saved yet. */
const current = (raw: unknown): FamilyConfig => familyFrom({ [FAMILY_KEY]: raw && Object.keys(raw).length ? raw : undefined }).cfg;

/** Who is in the split and the cost groups. Typed payments are kept. */
export const saveFamilySetupAction = guardedAction(
  {
    name: 'family.setup',
    revalidate: PATHS,
    validate: (i: { members: FamilyMember[]; groups: FamilyGroup[] }): FieldErrors | null => {
      if (!Array.isArray(i.members) || !Array.isArray(i.groups)) return { setup: 'Nothing to save.' };
      const problem = familyErrors(i);
      return problem ? { setup: problem } : null;
    },
  },
  async (input) => {
    await updateConfigKey<Partial<FamilyConfig>>(FAMILY_KEY, (raw) => {
      const was = current(raw);
      // A person or group with payments typed against them is not removed
      // silently with those payments: say so, and let them be deleted first.
      for (const p of was.payments) {
        if (!input.groups.some((g) => g.id === p.group)) {
          throw new Error(`“${was.groups.find((g) => g.id === p.group)?.name ?? 'A group'}” still has payments typed in. Delete them first.`);
        }
        if (!input.members.some((m) => m.id === p.member)) {
          throw new Error(`${was.members.find((m) => m.id === p.member)?.name ?? 'Someone'} still has payments typed in. Delete them first.`);
        }
      }
      return { members: input.members, groups: input.groups, payments: was.payments };
    });
    return { saved: true };
  },
);

/** A payment typed in — usually a brother's. Keyed by the form's opening, so a double tap adds one. */
export const addFamilyPaymentAction = guardedAction(
  {
    name: 'family.payment.add',
    revalidate: PATHS,
    validate: (i: { group: string; member: string; amount: string; day: string; note?: string; clientKey: string }): FieldErrors | null => {
      const errors: FieldErrors = {};
      if (!i.group?.trim()) errors['group'] = 'Choose what it was for.';
      if (!i.member?.trim()) errors['member'] = 'Choose who paid.';
      const a = parseUserAmount(i.amount);
      if (!a.ok || a.amount <= 0) errors['amount'] = 'Enter the amount paid.';
      if (!DAY.test(i.day ?? '')) errors['day'] = 'Choose the day it was paid.';
      if (!i.clientKey?.trim()) errors['amount'] = 'Open the form again.';
      return Object.keys(errors).length ? errors : null;
    },
  },
  async (input) => {
    const parsed = parseUserAmount(input.amount);
    if (!parsed.ok) throw new Error('Invalid amount.');
    await updateConfigKey<Partial<FamilyConfig>>(FAMILY_KEY, (raw) => {
      const was = current(raw);
      if (!was.groups.some((g) => g.id === input.group)) throw new Error('That group is no longer there.');
      if (!was.members.some((m) => m.id === input.member)) throw new Error('That person is no longer in the split.');
      const id = `fp-${input.clientKey}`;
      if (was.payments.some((p) => p.id === id)) return was;
      const note = input.note?.trim();
      return {
        ...was,
        payments: [...was.payments, { id, group: input.group, member: input.member, amount: parsed.amount, day: input.day, ...(note ? { note } : {}) }],
      };
    });
    return { added: true };
  },
);

export const deleteFamilyPaymentAction = guardedAction(
  { name: 'family.payment.delete', revalidate: PATHS, validate: (i: { id: string }) => (i.id?.trim() ? null : { id: 'Missing payment.' }) },
  async (input) => {
    await updateConfigKey<Partial<FamilyConfig>>(FAMILY_KEY, (raw) => {
      const was = current(raw);
      return { ...was, payments: was.payments.filter((p) => p.id !== input.id) };
    });
    return { deleted: true };
  },
);

/** Leave one of the owner's entries out of a group it matched by its words — or put it back. */
export const excludeFromGroupAction = guardedAction(
  {
    name: 'family.exclude',
    revalidate: PATHS,
    validate: (i: { group: string; tx: string; out: boolean }) => (i.group?.trim() && i.tx?.trim() ? null : { tx: 'Missing entry.' }),
  },
  async (input) => {
    await updateConfigKey<Partial<FamilyConfig>>(FAMILY_KEY, (raw) => {
      const was = current(raw);
      return {
        ...was,
        groups: was.groups.map((g) => {
          if (g.id !== input.group) return g;
          const rest = (g.exclude ?? []).filter((x) => x !== input.tx);
          return { ...g, exclude: input.out ? [...rest, input.tx] : rest };
        }),
      };
    });
    return { done: true };
  },
);
