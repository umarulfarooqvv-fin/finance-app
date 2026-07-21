import { getDb } from './db.js';
import { loadFromStore } from './sync.js';
import { getConfig } from './sheets.js';
import { storeEnabled, getVersion } from './store.js';

// The SQLite compute cache is rebuilt from Supabase (Postgres). ensureData()
// checks a monotonic version counter (bumped whenever data changes) and only
// reloads when something changed — so warm requests are instant. Config
// (cards, budgets, recurring, holdings, …) lives as JSON in app_config.

let loadedVersion = null;
let loadPromise = null;

export async function ensureData() {
  const db = getDb();
  if (!storeEnabled()) return; // no store configured (e.g. local dev) → stays empty
  const ver = await getVersion().catch(() => null);
  const hasData = db.prepare('SELECT COUNT(*) c FROM transactions').get().c > 0;
  if (hasData && loadedVersion !== null && ver === loadedVersion) return; // cache fresh
  if (!loadPromise) {
    loadPromise = boot(db, ver).finally(() => { loadPromise = null; });
  }
  await loadPromise;
}

async function boot(db, ver) {
  await loadFromStore();
  await applyCardConfig(db).catch(() => {});
  const { loadDefsFromSheet } = await import('./recurring.js');
  await loadDefsFromSheet(db).catch(() => {});
  await applyAccountConfig(db).catch(() => {});
  const { loadCreditStatusFromSheet } = await import('./credit.js');
  await loadCreditStatusFromSheet(db).catch(() => {});
  const { loadBudgetsFromSheet } = await import('./budgets.js');
  await loadBudgetsFromSheet(db).catch(() => {});
  const { loadHoldingsFromSheet, loadInvoicesFromSheet } = await import('./holdings.js');
  await loadHoldingsFromSheet(db).catch(() => {});
  await loadInvoicesFromSheet(db).catch(() => {});
  loadedVersion = ver;
}

/** Apply account settings (opening balances + since-date) from AppConfig. */
export async function applyAccountConfig(db = getDb()) {
  const r = await getConfig('accounts');
  if (!r || !r.value) return 0;
  const { accounts = [], since = null } = JSON.parse(r.value);
  const up = db.prepare(`
    INSERT INTO accounts (name, opening_balance, color, active)
    VALUES (@name, @opening_balance, @color, @active)
    ON CONFLICT(name) DO UPDATE SET opening_balance=@opening_balance, color=@color, active=@active
  `);
  for (const a of accounts) up.run(a);
  if (since) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('balance_since', ?)").run(since);
  return accounts.length;
}

/** Apply card settings stored as JSON in app_config. */
export async function applyCardConfig(db = getDb()) {
  const r = await getConfig('cards');
  if (!r || !r.value) return 0;
  const cards = JSON.parse(r.value);
  const up = db.prepare(`
    INSERT INTO cards (name, bill_date, grace_days, due_day, due_cycle, credit_limit, opening_balance, opening_date, color, active)
    VALUES (@name, @bill_date, @grace_days, @due_day, @due_cycle, @credit_limit, @opening_balance, @opening_date, @color, @active)
    ON CONFLICT(name) DO UPDATE SET bill_date=@bill_date, grace_days=@grace_days, due_day=@due_day,
      due_cycle=@due_cycle, credit_limit=@credit_limit, opening_balance=@opening_balance,
      opening_date=@opening_date, color=@color, active=@active
  `);
  for (const c of cards) {
    up.run({
      name: c.name, bill_date: c.bill_date, grace_days: c.grace_days,
      due_day: c.due_day ?? null, due_cycle: c.due_cycle ?? 'same',
      credit_limit: c.credit_limit ?? 0, opening_balance: c.opening_balance ?? 0,
      opening_date: c.opening_date ?? null, color: c.color ?? null, active: c.active ?? 1,
    });
  }
  return cards.length;
}

/** Persist current card settings as JSON in app_config. */
export async function saveCardConfig(db = getDb()) {
  if (!storeEnabled()) return false;
  const { setConfig } = await import('./sheets.js');
  const cards = db.prepare('SELECT * FROM cards').all();
  await setConfig('cards', JSON.stringify(cards));
  return true;
}
