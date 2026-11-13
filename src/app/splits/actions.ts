'use server';

import { guardedAction } from '@/lib/actions';
import { updateConfigKey } from '@/lib/config';
import { parseUserAmount } from '@/lib/money';
import { ME, SPLITS_KEY, splitsFrom } from '@/lib/splits';
import type { Split } from '@/lib/splits';
import type { FieldErrors } from '@/lib/action-result';

/* ===========================================================================
   The Splits page's writes — all in `splits` in app_config, never the ledger.
   Each is a read-modify-write of the whole list (updateConfigKey), and every
   new item's id comes from the form's opening, so a double tap adds one.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY.
   =========================================================================== */

const PATHS = ['/splits'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function change(mutate: (all: Split[]) => Split[]): Promise<void> {
  await updateConfigKey<Split[]>(SPLITS_KEY, (raw) => mutate(splitsFrom({ [SPLITS_KEY]: raw })));
}

async function changeOne(id: string, mutate: (s: Split) => Split): Promise<void> {
  await change((all) => {
    if (!all.some((s) => s.id === id)) throw new Error('That split is no longer there.');
    return all.map((s) => (s.id === id ? mutate(s) : s));
  });
}

const amountError = (raw: string) => {
  const a = parseUserAmount(raw);
  return a.ok && a.amount > 0 ? null : 'Enter the amount.';
};
const amountOf = (raw: string) => {
  const a = parseUserAmount(raw);
  if (!a.ok) throw new Error('Invalid amount.');
  return a.amount;
};

type SplitSetup = { id: string; name: string; day: string; friends: { id: string; name: string }[]; match: string[] };

/** Make a split, or change its name, people or the words that find your entries. */
export const saveSplitAction = guardedAction(
  {
    name: 'split.save',
    revalidate: PATHS,
    validate: (i: SplitSetup): FieldErrors | null => {
      if (!i.id?.trim()) return { name: 'Open the form again.' };
      if (!i.name?.trim()) return { name: 'Give it a name, e.g. “Wayanad trip”.' };
      if (!DAY.test(i.day ?? '')) return { day: 'Choose the day.' };
      if (!Array.isArray(i.friends) || i.friends.filter((f) => f.name?.trim()).length === 0) return { friends: 'Add at least one friend.' };
      return null;
    },
  },
  async (input) => {
    const friends = input.friends.filter((f) => f.name.trim() && f.id && f.id !== ME).map((f) => ({ id: f.id, name: f.name.trim() }));
    await change((all) => {
      const was = all.find((s) => s.id === input.id);
      if (was) {
        // Someone with an expense or a settle-up cannot just vanish from it.
        const kept = new Set([ME, ...friends.map((f) => f.id)]);
        const used = [...was.expenses.map((e) => e.payer), ...was.settlements.flatMap((s) => [s.from, s.to])];
        const gone = used.find((p) => !kept.has(p));
        if (gone) throw new Error(`${was.people.find((p) => p.id === gone)?.name ?? 'Someone'} has payments in this split. Delete those first.`);
        return all.map((s) => (s.id === input.id ? { ...s, name: input.name.trim(), day: input.day, people: friends, match: input.match } : s));
      }
      return [{ id: input.id, name: input.name.trim(), day: input.day, people: friends, match: input.match, expenses: [], settlements: [] }, ...all];
    });
    return { id: input.id };
  },
);

export const deleteSplitAction = guardedAction(
  { name: 'split.delete', revalidate: PATHS, validate: (i: { id: string }) => (i.id?.trim() ? null : { id: 'Missing split.' }) },
  async (input) => {
    await change((all) => all.filter((s) => s.id !== input.id));
    return { deleted: true };
  },
);

export const addSplitExpenseAction = guardedAction(
  {
    name: 'split.expense.add',
    revalidate: PATHS,
    validate: (i: { split: string; payer: string; amount: string; day: string; note?: string; among: string[]; clientKey: string }): FieldErrors | null => {
      const errors: FieldErrors = {};
      if (!i.payer?.trim()) errors['payer'] = 'Choose who paid.';
      const a = amountError(i.amount);
      if (a) errors['amount'] = a;
      if (!DAY.test(i.day ?? '')) errors['day'] = 'Choose the day.';
      if (!Array.isArray(i.among) || i.among.length === 0) errors['among'] = 'Choose who it was for.';
      if (!i.clientKey?.trim()) errors['amount'] = 'Open the form again.';
      return Object.keys(errors).length ? errors : null;
    },
  },
  async (input) => {
    const amount = amountOf(input.amount);
    await changeOne(input.split, (s) => {
      const ids = new Set([ME, ...s.people.map((p) => p.id)]);
      if (!ids.has(input.payer)) throw new Error('That person is not in this split.');
      const id = `se-${input.clientKey}`;
      if (s.expenses.some((e) => e.id === id)) return s;
      const among = input.among.filter((p) => ids.has(p));
      const note = input.note?.trim();
      return {
        ...s,
        expenses: [...s.expenses, {
          id, payer: input.payer, amount, day: input.day,
          ...(note ? { note } : {}),
          ...(among.length && among.length < ids.size ? { among } : {}),
        }],
      };
    });
    return { added: true };
  },
);

export const deleteSplitExpenseAction = guardedAction(
  { name: 'split.expense.delete', revalidate: PATHS, validate: (i: { split: string; id: string }) => (i.split && i.id ? null : { id: 'Missing expense.' }) },
  async (input) => {
    await changeOne(input.split, (s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== input.id) }));
    return { deleted: true };
  },
);

/** Settling up: "Received" (money changed hands) or "Write off" (it never will — a loss). */
export const settleSplitAction = guardedAction(
  {
    name: 'split.settle',
    revalidate: PATHS,
    validate: (i: { split: string; from: string; to: string; amount: string; day: string; clientKey: string; kind?: 'paid' | 'writeoff' }): FieldErrors | null => {
      if (!i.from || !i.to || i.from === i.to) return { from: 'Choose who paid whom.' };
      const a = amountError(i.amount);
      if (a) return { amount: a };
      if (!DAY.test(i.day ?? '')) return { day: 'Choose the day.' };
      return i.clientKey?.trim() ? null : { amount: 'Try again.' };
    },
  },
  async (input) => {
    const amount = amountOf(input.amount);
    await changeOne(input.split, (s) => {
      const ids = new Set([ME, ...s.people.map((p) => p.id)]);
      if (!ids.has(input.from) || !ids.has(input.to)) throw new Error('That person is not in this split.');
      const id = `ss-${input.clientKey}`;
      if (s.settlements.some((x) => x.id === id)) return s;
      return {
        ...s,
        settlements: [...s.settlements, {
          id, from: input.from, to: input.to, amount, day: input.day,
          ...(input.kind === 'writeoff' ? { kind: 'writeoff' as const } : {}),
        }],
      };
    });
    return { settled: true };
  },
);

export const deleteSettlementAction = guardedAction(
  { name: 'split.settle.delete', revalidate: PATHS, validate: (i: { split: string; id: string }) => (i.split && i.id ? null : { id: 'Missing payment.' }) },
  async (input) => {
    await changeOne(input.split, (s) => ({ ...s, settlements: s.settlements.filter((x) => x.id !== input.id) }));
    return { deleted: true };
  },
);

/** Leave one of your entries out of a split it matched by its tag or words — or put it back. */
export const excludeFromSplitAction = guardedAction(
  { name: 'split.exclude', revalidate: PATHS, validate: (i: { split: string; tx: string; out: boolean }) => (i.split && i.tx ? null : { tx: 'Missing entry.' }) },
  async (input) => {
    await changeOne(input.split, (s) => {
      const rest = (s.exclude ?? []).filter((x) => x !== input.tx);
      return { ...s, exclude: input.out ? [...rest, input.tx] : rest };
    });
    return { done: true };
  },
);

/** Put some of your own entries into a split — usually the Credit Given ones logged when you paid first. */
export const includeInSplitAction = guardedAction(
  {
    name: 'split.include',
    revalidate: PATHS,
    validate: (i: { split: string; txs: string[] }) => (i.split && Array.isArray(i.txs) && i.txs.length ? null : { txs: 'Choose at least one entry.' }),
  },
  async (input) => {
    await changeOne(input.split, (s) => {
      const include = [...new Set([...(s.include ?? []), ...input.txs])];
      // Picking an entry back in undoes leaving it out.
      const exclude = (s.exclude ?? []).filter((x) => !input.txs.includes(x));
      return { ...s, include, exclude };
    });
    return { added: input.txs.length };
  },
);
