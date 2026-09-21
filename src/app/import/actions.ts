'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { createTransaction } from '@/lib/transactions';
import { validateTransaction, type TransactionInput } from '@/lib/validation';
import { currentSnapshot } from '@/lib/views';
import type { FieldErrors } from '@/lib/action-result';

/* ===========================================================================
   Saving a pasted batch.

   One action for the whole batch rather than one call per row: twenty separate
   writes can half-succeed across a dropped connection, and the person is then
   left guessing which half. This reports exactly what happened to each row.

   IT DOES NOT STOP AT THE FIRST FAILURE. A batch is typed by a person who has
   already read the table, so a row the server refuses is a surprise — and
   abandoning nineteen good rows because the twentieth has a bad date turns one
   surprise into a lost evening. Every row is attempted; the failures come back
   named.

   IDEMPOTENT PER ROW. The client key is derived from the row's own content, so
   pressing Import twice — or once on a flaky connection — resolves to the same
   id rather than doubling the batch. That is the same guarantee the entry
   dialog has, and the reason the amounts on this app can be trusted after a
   retry.
   =========================================================================== */

export type ImportInput = {
  rows: {
    clientKey: string;
    ts: string;
    amount: string;
    method: string;
    category: string;
    remarks: string;
  }[];
};

export type ImportOutcome = {
  saved: number;
  duplicates: number;
  failed: { remarks: string; ts: string; error: string }[];
};

/** Above this a paste is more likely a mistake than an evening's backlog. */
const MAX_ROWS = 200;

export const importEntriesAction = guardedAction(
  {
    name: 'transaction.import',
    revalidate: MONEY_PATHS,
    validate: (input: ImportInput): FieldErrors | null => {
      if (!Array.isArray(input.rows) || input.rows.length === 0) {
        return { rows: 'There is nothing to import.' };
      }
      if (input.rows.length > MAX_ROWS) {
        return { rows: `That is ${input.rows.length} rows. Import at most ${MAX_ROWS} at a time.` };
      }
      /* Validated here as well as per row below, so a batch with an obviously
         broken row is refused before any of it is written rather than
         half-way through. */
      for (const r of input.rows) {
        const errors = validateTransaction(r as TransactionInput, r.ts.slice(0, 10));
        if (errors) {
          const first = Object.values(errors)[0] ?? 'Invalid row.';
          return { rows: `${r.remarks || 'A row'} on ${r.ts.slice(0, 10)}: ${first}` };
        }
        if (!r.clientKey) return { rows: 'A row arrived without an idempotency key.' };
      }
      return null;
    },
  },
  async (input, ctx): Promise<ImportOutcome> => {
    // Re-checked against the SERVER's date, never the client's.
    const { today } = await currentSnapshot();

    const out: ImportOutcome = { saved: 0, duplicates: 0, failed: [] };

    for (const row of input.rows) {
      const errors = validateTransaction(row as TransactionInput, today);
      if (errors) {
        out.failed.push({
          remarks: row.remarks,
          ts: row.ts,
          error: Object.values(errors)[0] ?? 'Invalid row.',
        });
        continue;
      }

      try {
        const result = await createTransaction(row as TransactionInput & { clientKey: string }, ctx, 'import');
        if (result.duplicate) out.duplicates += 1;
        else out.saved += 1;
      } catch (err) {
        out.failed.push({
          remarks: row.remarks,
          ts: row.ts,
          error: err instanceof Error ? err.message : 'Could not save this row.',
        });
      }
    }

    return out;
  },
);
