import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Emulates Supabase's PostgREST responses so the store/load path can be tested
// without a live database.
function mockSupabase(state) {
  const resp = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '').split('?')[0];
    const method = init.method || 'GET';
    if (method === 'GET') {
      if (table === 'app_state') return resp([{ value: state.version || 0 }]);
      if (table === 'transactions') return resp(state.transactions || []);
      if (table === 'income') return resp(state.income || []);
      if (table === 'app_config') {
        const key = (u.searchParams.get('key') || '').replace('eq.', '');
        const v = (state.config || {})[key];
        return resp(v != null ? [{ value: v }] : []);
      }
      return resp([]);
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      state[table] = (state[table] || []).concat(body);
      return resp(body);
    }
    return resp([]);
  };
}

test('Supabase store: load path + ingestion', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-store-'));
  const prev = process.cwd();
  process.chdir(tmp);
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-key';

  const { normalizeEntry, istIso } = await import('../lib/parser.js');
  const { loadFromStore } = await import('../lib/sync.js');
  const { getDb } = await import('../lib/db.js');
  const { appendRow, writesEnabled } = await import('../lib/sheets.js');
  const { statementView } = await import('../lib/cycles.js');

  try {
    await t.test('istIso yields a valid IST wall-clock string', () => {
      assert.match(istIso(new Date('2026-07-20T00:00:00Z')), /^2026-07-20T05:30:\d{2}$/); // UTC+5:30
    });

    await t.test('writesEnabled reflects Supabase env', () => {
      assert.equal(writesEnabled(), true);
    });

    await t.test('loadFromStore hydrates the SQLite compute cache', async () => {
      const rows = [
        normalizeEntry({ amount: 500, method: 'Edge', category: 'Food', remarks: 'Lunch', date: new Date(2026, 5, 2) }, { deterministic: true }),
        normalizeEntry({ amount: 1000, method: 'Fi', category: 'Edge', remarks: 'Edge bill', date: new Date(2026, 5, 3) }, { deterministic: true }),
      ];
      // Postgres returns numeric as string and jsonb as object — mimic that:
      const state = {
        version: 1,
        transactions: rows.map((r) => ({ ...r, amount: String(r.amount), tags: r.tags, verified: r === rows[0] })),
        income: [],
        config: {},
      };
      mockSupabase(state);

      const res = await loadFromStore();
      assert.equal(res.total, 2);
      const db = getDb();
      assert.equal(db.prepare('SELECT COUNT(*) c FROM transactions').get().c, 2);
      // A card spend and a card payment classified correctly
      assert.equal(db.prepare("SELECT kind FROM transactions WHERE method='Edge' AND category='Food'").get().kind, 'spend');
      assert.equal(db.prepare("SELECT kind FROM transactions WHERE category='Edge'").get().kind, 'card_payment');
      // verified flag flowed into annotations
      assert.equal(db.prepare('SELECT COUNT(*) c FROM annotations WHERE verified=1').get().c, 1);
      // engine runs over the loaded cache
      const v = statementView(new Date(2026, 5, 11));
      assert.ok(Array.isArray(v.rows) && v.rows.length > 0);
    });

    await t.test('appendRow (ingestion) inserts a normalized transaction', async () => {
      const state = { version: 1, transactions: [], income: [], config: {} };
      mockSupabase(state);
      const r = await appendRow({ amount: '250', method: 'ICICI', category: 'Fuel', remarks: 'Petrol', source: 'shortcut' });
      assert.ok(r.row);
      assert.equal(state.transactions.length, 1);
      const ins = state.transactions[0];
      assert.equal(ins.kind, 'spend');
      assert.equal(ins.card_affected, 'ICICI');
      assert.equal(ins.card_direction, 'debt+');
      assert.equal(ins.source, 'shortcut');
      assert.match(ins.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    await t.test('income ingestion routes to the income table', async () => {
      const state = { version: 1, transactions: [], income: [], config: {} };
      mockSupabase(state);
      await appendRow({ tab: 'Form Responses 2', amount: '5000', source: 'Salary', account: 'Fi', remarks: 'June' });
      assert.equal(state.income.length, 1);
      assert.equal(state.income[0].source, 'Salary');
    });
  } finally {
    process.chdir(prev);
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    globalThis.fetch = undefined;
  }
});
