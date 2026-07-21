import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, 'fixture.csv'), 'utf8');

test('recurring engine', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-rec-'));
  const prev = process.cwd();
  process.chdir(tmp);
  globalThis.fetch = async () => ({ ok: true, text: async () => fixture });

  const { syncFromSheet } = await import('../lib/sync.js');
  const { newDef, defStatus, sheetUpcoming, buildPostRow } = await import('../lib/recurring.js');
  const { getDb } = await import('../lib/db.js');
  await syncFromSheet();
  const db = getDb();
  const today = new Date(2026, 5, 11); // 11-Jun-2026

  try {
    await t.test('posted/due/upcoming statuses', () => {
      // Minoxidil exists in fixture on 11-Mar, 7-Apr, 11-May → those are "posted";
      // June occurrence (11-Jun) has no row yet → "due"; July+ → upcoming.
      const def = newDef({
        name: 'Minoxidil', amount: 649.19, method: 'ICICI', category: 'Personal',
        firstDate: '2026-03-11', dayOfMonth: 11, months: null,
      });
      const st = defStatus(def, db, today);
      assert.ok(st.postedCount >= 3, `expected >=3 posted, got ${st.postedCount}`);
      assert.equal(st.due.length, 1);
      assert.equal(st.due[0].date, '2026-06-11');
      assert.ok(st.nextUpcoming.date > '2026-06-11');
    });

    await t.test('finite EMI def with {n}/{m} template', () => {
      const def = newDef({
        name: 'Test EMI', amount: 1000, method: 'Coral', category: 'Personal',
        remarks: 'Test EMI {n}/{m}', firstDate: '2026-05-01', months: 3,
      });
      const st = defStatus(def, db, today);
      assert.equal(st.occurrences.length, 3);
      assert.equal(st.due.length, 2); // May & Jun passed, nothing posted
      assert.equal(st.due[0].remarks, 'Test EMI 1/3');
      assert.equal(st.nextUpcoming.remarks, 'Test EMI 3/3');
      const row = buildPostRow(def, st.due[0].k);
      assert.equal(row.timestamp, '5/1/2026 12:00:00');
      assert.equal(row.remarks, 'Test EMI 1/3');
    });

    await t.test('sheet-prelogged future EMIs grouped as upcoming', () => {
      const groups = sheetUpcoming(db, today);
      const ipad = groups.find((g) => /ipad mini/i.test(g.series));
      assert.ok(ipad, 'iPad Mini series should be detected');
      // Fixture pre-logs Jul-26 → Feb-27: 8 months × 3 rows (principal/charge/tax)
      assert.ok(ipad.items.length >= 24, `expected >=24 upcoming rows, got ${ipad.items.length}`);
      assert.ok(ipad.items.every((i) => i.date > '2026-06-11'));
    });
  } finally {
    process.chdir(prev);
  }
});
