import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Full pipeline against a snapshot of the real sheet (captured 10-Jun-2026):
// sync → SQLite → cycle engine. Uses a temp working dir so the real
// data/finance.db is never touched.

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, 'fixture.csv'), 'utf8');

test('end-to-end: sync fixture, cycle identities, idempotency', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-test-'));
  const prevCwd = process.cwd();
  process.chdir(tmp);
  globalThis.fetch = async () => ({ ok: true, text: async () => fixture });

  try {
    const { syncFromSheet } = await import('../lib/sync.js');
    const { statementView } = await import('../lib/cycles.js');
    const { getDb } = await import('../lib/db.js');

    const r1 = await syncFromSheet();
    assert.ok(r1.total > 300, `expected 300+ rows, got ${r1.total}`);
    assert.equal(r1.added, r1.total);

    const db = getDb();
    // Only the two known incomplete rows should need review
    assert.equal(db.prepare('SELECT COUNT(*) c FROM transactions WHERE needs_review=1').get().c, 2);
    // No unknown kinds, no unparsed timestamps
    assert.equal(db.prepare("SELECT COUNT(*) c FROM transactions WHERE kind='unknown'").get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM transactions WHERE ts IS NULL').get().c, 0);

    // Cycle identity must hold for every card: opening + spends − repayments = closing
    const v = statementView();
    for (const row of v.rows) {
      const cm = row.cycleMath;
      assert.ok(
        Math.abs(cm.openingBalance + cm.cycleSpends - cm.cycleRepayments - cm.closingBalance) < 0.01,
        `cycle identity failed for ${row.card}`
      );
      // remainingDue + unbilled must equal live debt
      assert.ok(
        Math.abs(row.remainingDueBill + row.unbilled - row.totalDebtLive) < 0.01,
        `bill+unbilled != live for ${row.card}`
      );
    }
    // Totals are sums of rows
    const sumLive = v.rows.reduce((a, r) => a + r.totalDebtLive, 0);
    assert.ok(Math.abs(sumLive - v.totals.totalDebtLive) < 0.01);

    // Re-sync is idempotent
    const r2 = await syncFromSheet();
    assert.equal(r2.added, 0);
    assert.equal(r2.total, r1.total);
  } finally {
    process.chdir(prevCwd);
  }
});
