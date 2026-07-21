import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, 'fixture.csv'), 'utf8');

test('credit given ledger', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-cred-'));
  const prev = process.cwd();
  process.chdir(tmp);
  globalThis.fetch = async () => ({ ok: true, text: async () => fixture });

  const { syncFromSheet } = await import('../lib/sync.js');
  const { creditLedger, setCreditStatus, guessPerson } = await import('../lib/credit.js');
  const { getDb } = await import('../lib/db.js');
  await syncFromSheet();
  const db = getDb();

  try {
    await t.test('person guessing strips EMI/tags', () => {
      assert.equal(guessPerson("Sheya's 19/24 Emi"), "Sheya's");
      assert.equal(guessPerson('Ipad Mini 13/24 (Cirqle)'), 'Ipad Mini');
      assert.equal(guessPerson('Arshadali'), 'Arshadali');
    });

    await t.test('ledger totals: given = received + outstanding', () => {
      const l = creditLedger(db);
      assert.ok(l.totals.given > 0);
      assert.ok(Math.abs(l.totals.given - l.totals.received - l.totals.outstanding) < 0.01);
      const sumPeople = l.people.reduce((a, p) => a + p.outstanding, 0);
      assert.ok(Math.abs(sumPeople - l.totals.outstanding) < 0.01);
    });

    await t.test('mark received / partial / reopen', async () => {
      const before = creditLedger(db);
      const entry = before.people.flatMap((p) => p.entries).find((e) => e.status === 'open' && e.amount > 100);
      assert.ok(entry);

      await setCreditStatus({ txId: entry.id, status: 'received' }, db);
      let after = creditLedger(db);
      assert.ok(Math.abs(after.totals.outstanding - (before.totals.outstanding - entry.amount)) < 0.01);

      await setCreditStatus({ txId: entry.id, status: 'partial', receivedAmount: 50 }, db);
      after = creditLedger(db);
      assert.ok(Math.abs(after.totals.outstanding - (before.totals.outstanding - 50)) < 0.01);

      await setCreditStatus({ txId: entry.id, status: 'open' }, db);
      after = creditLedger(db);
      assert.ok(Math.abs(after.totals.outstanding - before.totals.outstanding) < 0.01);
    });

    await t.test('person assignment groups matching remarks', async () => {
      const l = creditLedger(db);
      const entry = l.people.flatMap((p) => p.entries).find((e) => /arshadali/i.test(e.remarks));
      assert.ok(entry);
      await setCreditStatus({ txId: entry.id, person: 'Arshad Ali' }, db);
      const after = creditLedger(db);
      const grp = after.people.find((p) => p.person === 'Arshad Ali');
      assert.ok(grp);
      // "Cash withdrawals arshadali" should also fall under Arshad Ali via name matching
      assert.ok(grp.entries.length >= 2, `expected grouped entries, got ${grp.entries.length}`);
    });
  } finally {
    process.chdir(prev);
  }
});
