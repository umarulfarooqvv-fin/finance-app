'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { currentSnapshot } from '@/lib/views';
import { createIncome, deleteIncome, restoreIncome, updateIncome } from '@/lib/income';
import { validateIncome, type IncomeInput } from '@/lib/validation';

/* ===========================================================================
   Server actions for income.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY. Input types
   live in lib/validation and are imported, never re-exported: a surviving
   `export type` throws at module evaluation and 500s every action here.
   =========================================================================== */

const REVALIDATE = [...MONEY_PATHS, '/income'];

async function serverToday(): Promise<string> {
  const { today } = await currentSnapshot();
  return today;
}

export const createIncomeAction = guardedAction(
  {
    name: 'income.create',
    revalidate: REVALIDATE,
    validate: (input: IncomeInput & { clientKey: string }) =>
      validateIncome(input, input.ts.slice(0, 10)),
  },
  async (input, ctx) => {
    // Re-check the date window against the SERVER's clock, never the payload's.
    const errors = validateIncome(input, await serverToday());
    if (errors) throw new Error(Object.values(errors)[0] ?? 'Invalid entry.');
    return createIncome(input, ctx);
  },
);

export const updateIncomeAction = guardedAction(
  {
    name: 'income.update',
    revalidate: REVALIDATE,
    validate: (input: IncomeInput & { id: string }) =>
      input.id ? validateIncome(input, input.ts.slice(0, 10)) : { id: 'Missing entry id.' },
  },
  async (input, ctx) => {
    const errors = validateIncome(input, await serverToday());
    if (errors) throw new Error(Object.values(errors)[0] ?? 'Invalid entry.');
    return updateIncome(input.id, input, ctx);
  },
);

export const deleteIncomeAction = guardedAction(
  { name: 'income.delete', revalidate: REVALIDATE },
  async (input: { id: string }, ctx) => deleteIncome(input.id, ctx),
);

export const restoreIncomeAction = guardedAction(
  { name: 'income.restore', revalidate: REVALIDATE },
  async (input: { id: string }, ctx) => restoreIncome(input.id, ctx),
);
