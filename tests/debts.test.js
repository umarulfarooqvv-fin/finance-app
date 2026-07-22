import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, 'fixture.csv'), 'utf8');

test('credit taken (debts) ledger + net worth', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-debt-'));
  const prev = process.cwd();
  process.chdir(tmp);
  globalThis.fetch = async () => ({ ok: true, text: async () => fixture });

  const { syncFromSheet } = await import('../lib/sync.js');
  const { getDb } = await import('../lib/db.js');
  const {
    listDebts,
    upsertDebt,
    addDebtPayment,
    deleteDebtPayment,
    deleteDebt,
    debtsOutstandingAt,
  } = await import('../lib/debts.js');
  const { netWorthSnapshot, netWorthTrend } = await import('../lib/networth.js');
  await syncFromSheet();
  const db = getDb();

  try {
    const before = netWorthSnapshot(db).netWorth;

    const aliyanka = await upsertDebt(
      { lender: 'Aliyanka', principal: 155000, borrowed_on: '2026-01-10' },
      db
    );
    const manaappa = await upsertDebt(
      { lender: 'Manaappa', principal: 70000, borrowed_on: '2026-03-05', kind: 'loan' },
      db
    );

    await t.test('balance to pay = principal − repayments', async () => {
      await addDebtPayment({ debt_id: aliyanka.id, amount: 25000, paid_on: '2026-04-01' }, db);
      await addDebtPayment({ debt_id: aliyanka.id, amount: 5000, paid_on: '2026-05-01' }, db);
      const { debts, totals } = listDebts(db);
      const a = debts.find((d) => d.id === aliyanka.id);
      assert.equal(a.repaid, 30000);
      assert.equal(a.balance, 125000);
      assert.equal(a.settled, false);
      assert.equal(totals.principal, 225000);
      assert.equal(totals.repaid, 30000);
      assert.equal(totals.outstanding, 195000);
      assert.equal(totals.openCount, 2);
    });

    await t.test('fully repaid debt settles and stops counting', async () => {
      const p = await addDebtPayment(
        { debt_id: manaappa.id, amount: 70000, paid_on: '2026-06-01' },
        db
      );
      const m = listDebts(db).debts.find((d) => d.id === manaappa.id);
      assert.equal(m.balance, 0);
      assert.equal(m.settled, true);
      assert.equal(listDebts(db).totals.outstanding, 125000);
      await deleteDebtPayment(p.id, db);
      assert.equal(listDebts(db).totals.outstanding, 195000);
    });

    await t.test('outstanding is date-aware', () => {
      // Before either borrowing date nothing is owed; after the first, only it.
      assert.equal(debtsOutstandingAt(db, '2025-12-31'), 0);
      assert.equal(debtsOutstandingAt(db, '2026-01-31'), 155000);
      // 25k repaid on 01-Apr, 5k on 01-May.
      assert.equal(debtsOutstandingAt(db, '2026-04-15'), 155000 - 25000 + 70000);
      assert.equal(debtsOutstandingAt(db, '2026-12-31'), 195000);
    });

    await t.test('net worth subtracts borrowed money', () => {
      const snap = netWorthSnapshot(db);
      assert.equal(snap.liabilities.creditTakenOutstanding, 195000);
      assert.equal(
        snap.totalLiabilities,
        Math.round((snap.liabilities.cardDebt + 195000) * 100) / 100
      );
      assert.equal(Math.round(snap.netWorth), Math.round(before - 195000));
    });

    await t.test('trend carries the debt line', () => {
      const { points } = netWorthTrend(db);
      assert.ok(points.length > 0);
      const last = points[points.length - 1];
      assert.equal(last.creditTakenOutstanding, 195000);
      // A month before either borrowing existed, no debt is subtracted.
      const early = points.find((p) => p.month < '2026-01');
      if (early) assert.equal(early.creditTakenOutstanding, 0);
    });

    await t.test('deleting a debt removes it from totals', async () => {
      await deleteDebt(aliyanka.id, db);
      const { debts, totals } = listDebts(db);
      assert.equal(
        debts.some((d) => d.id === aliyanka.id),
        false
      );
      assert.equal(totals.outstanding, 70000);
    });

    await t.test('rejects bad input', async () => {
      await assert.rejects(
        () => upsertDebt({ lender: '  ', principal: 10 }, db),
        /Lender required/
      );
      await assert.rejects(
        () => addDebtPayment({ debt_id: manaappa.id, amount: 0 }, db),
        /positive/
      );
      await assert.rejects(
        () => addDebtPayment({ debt_id: 'nope', amount: 10 }, db),
        /Unknown debt/
      );
    });
  } finally {
    process.chdir(prev);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
