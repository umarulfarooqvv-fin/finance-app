import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, 'fixture.csv'), 'utf8');

test('forecast, EMI, budgets, holdings, net worth', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-feat-'));
  const prev = process.cwd();
  process.chdir(tmp);
  globalThis.fetch = async () => ({ ok: true, text: async () => fixture });

  const { syncFromSheet } = await import('../lib/sync.js');
  const { getDb } = await import('../lib/db.js');
  const { forecast } = await import('../lib/forecast.js');
  const { emiItems } = await import('../lib/emi.js');
  const { getBudgets, saveBudgets, budgetOverview, budgetAlerts } = await import('../lib/budgets.js');
  const { upsertHolding, listHoldings, upsertInvoice, listInvoices, deleteHolding } = await import(
    '../lib/holdings.js'
  );
  const { netWorthSnapshot, netWorthTrend } = await import('../lib/networth.js');

  await syncFromSheet();
  const db = getDb();
  const now = new Date(2026, 5, 11); // 11-Jun-2026

  try {
    await t.test('forecast: reserve identity and projections', () => {
      const f = forecast({ method: 'runrate' }, db, now);
      assert.equal(f.daysInMonth, 30);
      assert.equal(f.daysRemaining, 30 - 11);
      assert.ok(f.monthToDate >= 0);
      // Recommended reserve = live debt + estimated remaining (spec §3.5)
      assert.ok(Math.abs(f.recommendedReserve - (f.totalDebtLive + f.estimatedRemaining)) < 0.05);
      // With pure run-rate, estimatedRemaining == runRateForecast (no recurring overlay)
      assert.ok(Math.abs(f.estimatedRemaining - f.runRateForecast) < 0.05);
      // Category projections sum to the run-rate forecast
      const catSum = f.byCategory.reduce((a, c) => a + c.projected, 0);
      assert.ok(Math.abs(catSum - f.runRateForecast) < 0.5, `${catSum} vs ${f.runRateForecast}`);
    });

    await t.test('EMI tracker: iPad Mini series detected as n/24', () => {
      const { items, totals } = emiItems(db, now);
      const ipad = items.find((i) => /ipad/i.test(i.name));
      assert.ok(ipad, 'iPad Mini EMI should be detected');
      assert.equal(ipad.totalInstallments, 24);
      assert.ok(ipad.installment > 0);
      assert.ok(ipad.schedule.length >= 12);
      assert.ok(ipad.paidCount + ipad.remaining <= 24 + 1);
      assert.ok(totals.count >= 1);
      assert.ok(totals.monthlyOutgo >= 0);
    });

    await t.test('budgets: save/get roundtrip and status logic', async () => {
      const over = budgetOverview(db, now);
      // pick the biggest-spending category and set a tiny budget → 'over'
      const top = over.unbudgeted[0];
      assert.ok(top, 'expected some unbudgeted spend');
      await saveBudgets({ [top.category]: 1 }, db); // ₹1 budget → guaranteed over
      const saved = getBudgets(db);
      assert.equal(saved[top.category], 1);
      const ov = budgetOverview(db, now);
      const row = ov.items.find((i) => i.category === top.category);
      assert.equal(row.status, 'over');
      assert.ok(row.spent > row.budget);
      assert.ok(budgetAlerts(db, now).some((a) => a.includes(top.category)));
      // A generous budget → not over
      await saveBudgets({ [top.category]: top.spent * 100 + 1000 }, db);
      const ov2 = budgetOverview(db, now);
      assert.notEqual(ov2.items.find((i) => i.category === top.category).status, 'over');
    });

    await t.test('holdings: savings + investment totals and invoices', async () => {
      const near = (a, b) => Math.abs(a - b) < 0.01;
      const base = listHoldings(db).totals; // account for seeded holdings
      await upsertHolding({ kind: 'savings', name: 'Emergency Fund', invested: 50000, current_value: 50000 }, db);
      const inv = await upsertHolding(
        { kind: 'investment', name: 'Index Fund', invested: 20000, current_value: 23000 },
        db
      );
      const { totals } = listHoldings(db);
      assert.ok(near(totals.savings, base.savings + 50000));
      assert.ok(near(totals.investment, base.investment + 23000));
      assert.ok(near(totals.invested, base.invested + 70000));
      assert.ok(near(totals.currentValue, base.currentValue + 73000));
      await deleteHolding(inv.id, db);
      assert.ok(near(listHoldings(db).totals.investment, base.investment));

      await upsertInvoice({ client: 'Cirqle', number: 'INV-1', amount: 15000, status: 'sent' }, db);
      await upsertInvoice({ client: 'Cirqle', number: 'INV-2', amount: 5000, status: 'paid' }, db);
      const iv = listInvoices(db);
      assert.equal(iv.totals.outstanding, 15000);
      assert.equal(iv.totals.paid, 5000);
      assert.equal(iv.clients[0].client, 'Cirqle');
    });

    await t.test('net worth: snapshot identity and trend shape', () => {
      const snap = netWorthSnapshot(db, now);
      assert.ok(
        Math.abs(snap.netWorth - (snap.totalAssets - snap.totalLiabilities)) < 0.05,
        'net = assets - liabilities'
      );
      // Emergency Fund (savings) counts toward assets
      assert.ok(snap.assets.savings >= 50000);
      const { points } = netWorthTrend(db, now);
      assert.ok(points.length >= 1);
      assert.equal(points[points.length - 1].month, '2026-06');
      for (const p of points) assert.equal(typeof p.netWorth, 'number');
    });
  } finally {
    process.chdir(prev);
  }
});
