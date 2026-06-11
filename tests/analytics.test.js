import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, 'fixture.csv'), 'utf8');

test('detailed expenses analytics on fixture', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-ana-'));
  const prev = process.cwd();
  process.chdir(tmp);
  globalThis.fetch = async () => ({ ok: true, text: async () => fixture });

  const { syncFromSheet } = await import('../lib/sync.js');
  const { detailedExpenses, displayCategory } = await import('../lib/analytics.js');
  await syncFromSheet();

  try {
    await t.test('display category mapping', () => {
      assert.equal(displayCategory({ kind: 'card_payment', remarks: 'Cleared' }), 'Credit Card');
      assert.equal(displayCategory({ kind: 'card_payment', remarks: 'Credit given to ashiq sudu is cleared' }), 'Credit Return');
      assert.equal(displayCategory({ kind: 'spend', category: 'Family', remarks: 'Sugar medicine uppa 50' }), 'Medicine');
      assert.equal(displayCategory({ kind: 'spend', category: 'Family', remarks: 'Supermarket shopping groceries' }), 'Groceries');
      assert.equal(displayCategory({ kind: 'spend', category: 'Food', remarks: 'Tea' }), 'Food');
      // Credit Given rows never get keyword-remapped
      assert.equal(displayCategory({ kind: 'credit_given', category: 'Credit Given', remarks: 'Jaseem recharge' }), 'Credit Given');
    });

    await t.test('range totals & identities', () => {
      const d = detailedExpenses({ from: '2026-04-01', to: '2026-06-10' });
      // total equals sum of category breakdown
      const sumCats = d.current.breakdown.reduce((a, b) => a + b.total, 0);
      assert.ok(Math.abs(sumCats - d.current.total) < 0.05, `${sumCats} vs ${d.current.total}`);
      // shares sum to ~1
      const shares = d.current.breakdown.reduce((a, b) => a + b.share, 0);
      assert.ok(Math.abs(shares - 1) < 0.001);
      // daily cumulative ends at total of in-range list
      if (d.daily.length) {
        const last = d.daily[d.daily.length - 1];
        const sumDaily = d.daily.reduce((a, x) => a + x.total, 0);
        assert.ok(Math.abs(last.cumulative - sumDaily) < 0.05);
      }
      // grouped transactions count equals current.count
      const grouped = d.groups.reduce((a, g) => a + g.transactions.length, 0);
      assert.equal(grouped, d.current.count);
      // comparison windows: month-ago window is Mar→May
      assert.equal(d.prevMonth.window[0].slice(0, 10), '2026-03-01');
      assert.equal(d.prevMonth.window[1].slice(0, 10), '2026-05-10');
    });

    await t.test('exclusions remove categories and methods', () => {
      const base = detailedExpenses({ from: '2026-04-01', to: '2026-06-10' });
      const noCC = detailedExpenses({ from: '2026-04-01', to: '2026-06-10', excludeCategories: ['Credit Card', 'Credit Return'] });
      assert.ok(noCC.current.total < base.current.total);
      assert.equal(noCC.current.breakdown.find((b) => b.category === 'Credit Card').total, 0);
      const noCash = detailedExpenses({ from: '2026-04-01', to: '2026-06-10', excludeMethods: ['Cash'] });
      assert.ok(noCash.current.total <= base.current.total);
    });

    await t.test('monthly series includes future EMI projection months (like the sheet)', () => {
      const d = detailedExpenses({ from: '2026-04-01', to: '2026-06-10' });
      const months = d.monthly.map((m) => m.month);
      assert.ok(months.includes('2026-07'), 'pre-logged EMI months should appear as projections');
      assert.ok(months.includes('2027-02'), 'last EMI month (Feb-27) should appear');
      // Projection month totals = EMI components only (fixture: Ipad 17/24 ≈ 2618.78)
      const jul = d.monthly.find((m) => m.month === '2026-07');
      assert.ok(Math.abs(jul.total - 2618.78) < 0.05, `Jul-26 projection ${jul.total}`);
    });
  } finally {
    process.chdir(prev);
  }
});
