'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { updateConfigKey } from '@/lib/config';
import { logEvent } from '@/lib/supabase';
import { parseUserAmount } from '@/lib/money';
import { isValidInstant } from '@/lib/validation';
import type { CycleOverride, CycleOverrides } from '@/lib/cycles';
import type { StatementBoundary } from '@/lib/types';

/* ===========================================================================
   Statement reconciliation actions.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY. Types are
   imported, never re-exported: a single `export type` survives the compiler
   transform as a value reference and 500s every action in the file.
   =========================================================================== */

const KEY = 'statement_cycles';

function validDay(day: string): boolean {
  return isValidInstant(`${day}T00:00:00`);
}

/** Merge one cycle's override without disturbing any other cycle or card. */
async function patchCycle(
  card: string,
  statementDate: string,
  patch: CycleOverride,
): Promise<void> {
  await updateConfigKey<CycleOverrides>(KEY, (current) => ({
    ...current,
    [card]: {
      ...(current[card] ?? {}),
      [statementDate]: { ...(current[card]?.[statementDate] ?? {}), ...patch },
    },
  }));
}

/** Record what the bank actually billed for one statement. */
export const recordStatementAction = guardedAction(
  {
    name: 'statement.record',
    revalidate: MONEY_PATHS,
    validate: (input: { card: string; statementDate: string; actual: string }) => {
      const errors: Record<string, string> = {};
      if (!input.card?.trim()) errors['card'] = 'Missing card.';
      if (!validDay(input.statementDate ?? '')) errors['statementDate'] = 'That is not a real date.';
      const amount = parseUserAmount(input.actual);
      if (!amount.ok) {
        errors['actual'] =
          amount.reason === 'empty' ? 'Enter the amount the bank billed.'
          : amount.reason === 'too-precise' ? 'Amounts go to the paisa.'
          : 'That is not a valid amount.';
      }
      return Object.keys(errors).length ? errors : null;
    },
  },
  async (input: { card: string; statementDate: string; actual: string }, ctx) => {
    const parsed = parseUserAmount(input.actual);
    if (!parsed.ok) throw new Error('Invalid amount.');

    await patchCycle(input.card, input.statementDate, { actual: parsed.amount });
    await logEvent('statement.record', {
      card: input.card, statementDate: input.statementDate,
      actual: parsed.amount, by: ctx.actor,
    });
    return { card: input.card, statementDate: input.statementDate, actual: parsed.amount };
  },
);

/**
 * Pin the cut-off for one statement.
 *
 * Normally set from a reconciliation verdict rather than by hand: the bank's
 * own figure says which rule it used, which is more reliable than a guess.
 */
export const setBoundaryAction = guardedAction(
  {
    name: 'statement.boundary',
    revalidate: MONEY_PATHS,
    validate: (input: { card: string; statementDate: string; boundary: StatementBoundary }) =>
      input.boundary === 'inclusive' || input.boundary === 'exclusive'
        ? null
        : { boundary: 'Unknown cut-off rule.' },
  },
  async (
    input: { card: string; statementDate: string; boundary: StatementBoundary },
    ctx,
  ) => {
    await patchCycle(input.card, input.statementDate, { boundary: input.boundary });
    await logEvent('statement.boundary', {
      card: input.card, statementDate: input.statementDate,
      boundary: input.boundary, by: ctx.actor,
    });
    return { card: input.card, statementDate: input.statementDate, boundary: input.boundary };
  },
);
