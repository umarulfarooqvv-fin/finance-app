import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, 'fixture.csv'), 'utf8');

// Exercises the same SQL/aggregation logic the /api/explore route uses,
// against the real-data fixture.
test('explore keyword analytics', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-exp-'));
  const prev = process.cwd();
  process.chdir(tmp);
  globalThis.fetch = async () => ({ ok: true, text: async () => fixture });

  const { syncFromSheet } = await import('../lib/sync.js');
  const { getDb } = await import('../lib/db.js');
  await syncFromSheet();
  const db = getDb();

  const search = (q) => db.prepare(`
    SELECT ts, amount, method, category, remarks FROM transactions
    WHERE deleted=0 AND amount IS NOT NULL AND ts IS NOT NULL AND kind<>'card_payment'
      AND ts<='2026-06-11T23:59:59'
      AND (remarks LIKE ? COLLATE NOCASE OR category LIKE ? COLLATE NOCASE OR method LIKE ? COLLATE NOCASE)
    ORDER BY ts ASC
  `).all(`%${q}%`, `%${q}%`, `%${q}%`);

  try {
    await t.test('keyword "barber" finds saloon spends, case-insensitive', () => {
      const rows = search('barber');
      assert.ok(rows.length >= 5, `expected several barber rows, got ${rows.length}`);
      assert.ok(rows.every((r) => /barber/i.test(r.remarks)));
    });

    await t.test('keyword "fuel" matches category too', () => {
      const rows = search('fuel');
      const cats = new Set(rows.map((r) => r.category));
      assert.ok(cats.has('Fuel'), 'should include category=Fuel rows');
      // remarks-only matches like "Fuel for car ..." under Family must appear too
      assert.ok(rows.some((r) => r.category !== 'Fuel' && /fuel/i.test(r.remarks)));
    });

    await t.test('card payments are excluded from spend search', () => {
      const rows = search('cleared');
      assert.ok(rows.every((r) => !['Edge', 'One Card', 'ICICI', 'Coral', 'Scapia', 'Super Money'].includes(r.category)));
    });
  } finally {
    process.chdir(prev);
  }
});
