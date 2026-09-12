import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireSession, type Actor } from '@/lib/auth';
import { fail, ok, type ActionResult, type FieldErrors } from '@/lib/action-result';
import { invalidateSnapshot } from '@/lib/snapshot';

/* ===========================================================================
   guardedAction — the only way a write reaches the database.

   The blueprint's L6 note is the design brief: Cirqle repeats a guard / try /
   revalidate preamble across 54 action files, and says a wrapper would have
   collapsed each to one line and made "did we forget the permission check?"
   a type error rather than a code review.

   So the handler signature DEMANDS an Actor, and an Actor can only be
   produced by requireSession(). There is no way to write a handler that skips
   the check and still compiles — the guard is structural, not a habit.

   Every wrapped action also gets, in order:
     - server-side validation before any I/O
     - a thrown error turned into a readable message, never a stack
     - cache invalidation, so the next read cannot serve pre-write data
     - path revalidation for the screens that display it
   =========================================================================== */

export type GuardedOptions<I> = {
  /** Human name; appears in server logs and the audit trail. */
  name: string;
  /** Pure, server-side. Returning any key rejects the write. */
  validate?: (input: I) => FieldErrors | null;
  /** Screens to refresh after a successful write. */
  revalidate?: string[];
};

/**
 * Postgres and network errors must never reach the browser verbatim: they
 * carry column names, constraint names and occasionally row contents. Known
 * failure modes get a sentence the user can act on; everything else gets a
 * generic message while the detail goes to the server log.
 */
function readable(err: unknown, name: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  console.error(`[action:${name}]`, raw);

  if (/duplicate key|23505/i.test(raw)) return 'That entry already exists.';

  // Check violations arrive as SQLSTATE 23514. These are the database's own
  // last line — validation should have caught them first, so reaching here
  // means either a bug or a caller that bypassed the form. The names are the
  // real constraint names from db/migrations/001_integrity.sql.
  if (/23514|violates check constraint/i.test(raw)) {
    if (/tx_amount_positive|income_amount_positive/i.test(raw)) {
      return 'Amounts must be positive — use the category to say where the money went.';
    }
    if (/tx_amount_ceiling/i.test(raw)) return 'That amount is larger than this app allows.';
    if (/ts_format/i.test(raw)) return 'That date is not in a valid format.';
    if (/tx_card_coherent/i.test(raw)) {
      return 'That entry names a card without saying which way the balance moves.';
    }
    if (/tx_kind_enum|tx_direction_enum/i.test(raw)) {
      return 'That entry has an unrecognised type.';
    }
    return 'That entry failed a database rule.';
  }
  if (/violates foreign key|23503/i.test(raw)) return 'That refers to something that no longer exists.';
  if (/23502|null value in column/i.test(raw)) return 'A required field was missing.';
  if (/not configured/i.test(raw)) return 'The database is not configured.';
  if (/fetch failed|ECONNREFUSED|ETIMEDOUT|network/i.test(raw)) {
    return 'Could not reach the database. Your change was not saved.';
  }
  return 'Something went wrong and the change was not saved.';
}

export function guardedAction<I, O>(
  opts: GuardedOptions<I>,
  // The Actor parameter is the point: a handler cannot be written without one.
  handler: (input: I, ctx: Actor) => Promise<O>,
): (input: I) => Promise<ActionResult<O>> {
  return async function run(input: I): Promise<ActionResult<O>> {
    // 1. Authorise first, before touching input or the database.
    const auth = await requireSession();
    if (!auth.ok) return fail(auth.error);

    // 2. Validate server-side. Client validation is a convenience; this is
    //    the one that counts, because the client can be bypassed entirely.
    if (opts.validate) {
      const errors = opts.validate(input);
      if (errors && Object.keys(errors).length > 0) {
        return fail('Please correct the highlighted fields.', errors);
      }
    }

    // 3. Run, converting any throw into a result the UI can render.
    let data: O;
    try {
      data = await handler(input, auth.ctx);
    } catch (err) {
      return fail(readable(err, opts.name));
    }

    // 4. A write must never leave a stale read behind it. Drop the snapshot
    //    cache before revalidating paths, so the re-render reads fresh data.
    invalidateSnapshot();
    for (const path of opts.revalidate ?? []) {
      revalidatePath(path);
    }

    return ok(data);
  };
}

/** Screens that show money and therefore must refresh after any write. */
export const MONEY_PATHS = [
  '/',
  '/cards',
  '/spending',
  '/transactions',
  '/money',
  '/ledgers',
];
