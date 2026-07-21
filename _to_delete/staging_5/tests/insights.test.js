import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, 'fixture.csv'), 'utf8');

test('insights, search, export, savings goals', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-ins-'));
  const prev = process.cwd();
  process.chdir(tmp);
  globalThis.fetch = async () => ({ ok: true, text: async () => fixture });

  const { syncFromSheet } = await import('../lib/sync.js');
  const { getDb } = await import('../lib/db.js');
  const { tripRollups, spendHeatmap, anomalies } = await import('../lib/insights.js');
  const { searchAll } = await import('../lib/search.js');
  const { exportJson, exportCsv } = await import('../lib/exportData.js');
  const { upsertHolding, listHoldings } = await import('../lib/holdings.js');

  await syncFromSheet();
  const db = getDb();
  const now = new Date(2026, 5, 11);

  try {
    await t.test('trip rollups group by trip tag', () => {
      const trips = tripRollups(db, now);
      const ponnani = trips.find((x) => /ponnani/i.test(x.trip));
      assert.ok(ponnani, 'Ponnani trip should be detected');
      assert.ok(ponnani.total > 0);
      assert.ok(ponnani.count >= 1);
      assert.ok(ponnani.from && ponnani.to);
    });

    await t.test('calendar heatmap returns daily totals', () => {
      const h = spendHeatmap(db, 6, now);
      assert.ok(Array.isArray(h.days));
      assert.ok(h.days.length > 0);
      assert.ok(h.max >= 0);
      for (const d of h.days) assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
    });

    await t.test('anomalies returns a sorted array', () => {
      const a = anomalies(db, now);
      assert.ok(Array.isArray(a));
      for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].ratio >= a[i].ratio);
    });

    await t.test('global search finds transactions', () => {
      const r = searchAll('Ponnani', db);
      assert.ok(r.total > 0);
      const txGroup = r.groups.find((g) => g.type === 'transactions');
      assert.ok(txGroup && txGroup.items.length > 0);
      assert.equal(searchAll('', db).total, 0);
    });

    await t.test('export json + csv', () => {
      const j = exportJson(db);
      assert.ok(j.counts.transactions > 0);
      assert.ok(j.tables.cards.length > 0);
      const csv = exportCsv('cards', db);
      assert.ok(csv.split('\n')[0].includes('name'));
      assert.throws(() => exportCsv('bogus', db));
    });

    await t.test('savings goal progress', async () => {
      await upsertHolding({ kind: 'savings', name: 'Car Fund', invested: 25000, current_value: 25000, target: 100000 }, db);
      const { holdings } = listHoldings(db);
      const car = holdings.find((h) => h.name === 'Car Fund');
      assert.equal(car.target, 100000);
      assert.ok(Math.abs(car.goalProgress - 0.25) < 0.001);
      assert.equal(car.goalRemaining, 75000);
    });
  } finally {
    process.chdir(prev);
  }
});
