import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { createTransaction, deleteTransaction, idFromKey, updateTransaction } from '@/lib/transactions';
import { select } from '@/lib/supabase';
import type { Actor } from '@/lib/auth';

/* ===========================================================================
   Live integration test — OPT-IN.

   Runs against the real Supabase instance and is skipped unless
   RUN_LIVE_TESTS=1 and credentials are present, so `npm test` stays offline,
   fast and safe by default.

     RUN_LIVE_TESTS=1 npm test

   It writes one clearly-marked ₹1 row, exercises the properties that cannot
   be proven with unit tests alone — that a retry does not duplicate, that an
   edit rewrites derived fields, that a delete is soft — and removes the row
   afterwards, whether or not the assertions pass.
   =========================================================================== */

const live =
  process.env['RUN_LIVE_TESTS'] === '1' &&
  Boolean(process.env['SUPABASE_URL']) &&
  Boolean(process.env['SUPABASE_SERVICE_KEY']);

const MARK = 'INTEGRATION TEST ROW — auto-removed';
const ctx: Actor = { actor: 'integration-test', via: 'open' };

async function hardDelete(id: string) {
  // The application only ever soft-deletes, deliberately. A test fixture is
  // not financial history, so this removes it outright rather than leaving a
  // tombstone in a real ledger.
  const url = (process.env['SUPABASE_URL'] ?? '').replace(/\/$/, '');
  const key = process.env['SUPABASE_SERVICE_KEY'] ?? '';
  await fetch(`${url}/rest/v1/transactions?id=eq.${id}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
}

async function rowsFor(id: string) {
  return select('transactions', { filters: { id: `eq.${id}` } });
}

describe.skipIf(!live)('write path against the live store', () => {
  test('a retried submission cannot create a second row', async () => {
    const clientKey = `test-${crypto.randomUUID()}`;
    const id = await idFromKey(clientKey);
    const input = {
      clientKey,
      amount: '1',
      method: 'Fi',
      category: 'Food',
      remarks: MARK,
      ts: '2026-08-22T12:00:00',
    };

    try {
      const first = await createTransaction(input, ctx);
      assert.equal(first.duplicate, false);
      assert.equal(first.id, id);

      // The same key again — exactly what a double tap or a retried request
      // after a timeout looks like.
      const second = await createTransaction(input, ctx);
      assert.equal(second.duplicate, true, 'a repeat must be reported, not written');
      assert.equal(second.id, id);

      const found = await rowsFor(id);
      assert.equal(found.length, 1, 'exactly one row may exist for one idempotency key');
      assert.equal(Number(found[0]!.amount), 1);
    } finally {
      await hardDelete(id);
    }
  });

  test('an edit rewrites derived fields and clears the verified tick', async () => {
    const clientKey = `test-${crypto.randomUUID()}`;
    const id = await idFromKey(clientKey);

    try {
      await createTransaction(
        { clientKey, amount: '1', method: 'Fi', category: 'Food', remarks: MARK, ts: '2026-08-22T12:00:00' },
        ctx,
      );
      const before = (await rowsFor(id))[0]!;
      assert.equal(before.kind, 'spend');
      assert.equal(before.card_affected, null, 'a bank method creates no card debt');

      // Change it into a card spend. kind and card_affected must follow.
      await updateTransaction(
        id,
        { amount: '2.50', method: 'Coral', category: 'Fuel', remarks: MARK, ts: '2026-08-22T12:00:00' },
        ctx,
      );

      const after = (await rowsFor(id))[0]!;
      assert.equal(Number(after.amount), 2.5);
      assert.equal(after.card_affected, 'Coral', 'the derived card must be recomputed, not carried over');
      assert.equal(after.verified, false, 'an edited row is no longer reconciled');
    } finally {
      await hardDelete(id);
    }
  });

  test('a delete is soft — the row survives for audit', async () => {
    const clientKey = `test-${crypto.randomUUID()}`;
    const id = await idFromKey(clientKey);

    try {
      await createTransaction(
        { clientKey, amount: '1', method: 'Fi', category: 'Food', remarks: MARK, ts: '2026-08-22T12:00:00' },
        ctx,
      );
      await deleteTransaction(id, ctx);

      const found = await rowsFor(id);
      assert.equal(found.length, 1, 'the row must still exist');
      assert.equal(found[0]!.deleted, true, 'and be flagged rather than removed');

      // Deleting twice is a no-op, not an error.
      await deleteTransaction(id, ctx);
    } finally {
      await hardDelete(id);
    }
  });

  test('no test rows are left behind', async () => {
    const leftovers = await select('transactions', {
      filters: { remarks: `like.*INTEGRATION TEST ROW*` },
    });
    assert.deepEqual(leftovers.map((r) => r.id), [], 'integration tests must clean up after themselves');
  });
});
