import { getDb } from './db.js';
import { syncFromSheet } from './sync.js';
import { writesEnabled, getMeta, getConfig } from './sheets.js';

// On Vercel the SQLite cache starts empty after every cold start. ensureData()
// rebuilds it: sheet rows → transactions, AppMeta → annotations, AppConfig →
// card settings. Locally it's a no-op once data exists.

let bootPromise = null;

export async function ensureData() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) c FROM transactions').get().c;
  if (count > 0) return;
  if (!bootPromise) {
    bootPromise = boot(db).finally(() => { bootPromise = null; });
  }
  await bootPromise;
}

async function boot(db) {
  await syncFromSheet();
  if (writesEnabled()) {
    await hydrateMeta(db).catch(() => {});
    await applyCardConfig(db).catch(() => {});
    const { loadDefsFromSheet } = await import('./recurring.js');
    await loadDefsFromSheet(db).catch(() => {});
  }
}

/** Pull verified flags from the sheet's AppMeta tab into local annotations. */
export async function hydrateMeta(db = getDb()) {
  const { meta } = await getMeta();
  const up = db.prepare(`
    INSERT INTO annotations (tx_id, verified, verified_at, note, synced_to_sheet)
    VALUES (?,?,?,?,1)
    ON CONFLICT(tx_id) DO UPDATE SET verified=excluded.verified, verified_at=excluded.verified_at, note=excluded.note, synced_to_sheet=1
  `);
  let n = 0;
  for (const m of meta || []) {
    if (!m.txId) continue;
    up.run(m.txId, m.verified ? 1 : 0, m.verifiedAt || null, m.note || null);
    n++;
  }
  return n;
}

/** Apply card settings stored in the sheet's AppConfig tab. */
export async function applyCardConfig(db = getDb()) {
  const r = await getConfig('cards');
  if (!r || !r.value) return 0;
  const cards = JSON.parse(r.value);
  const up = db.prepare(`
    INSERT INTO cards (name, bill_date, grace_days, credit_limit, color, active)
    VALUES (@name, @bill_date, @grace_days, @credit_limit, @color, @active)
    ON CONFLICT(name) DO UPDATE SET bill_date=@bill_date, grace_days=@grace_days,
      credit_limit=@credit_limit, color=@color, active=@active
  `);
  for (const c of cards) up.run(c);
  return cards.length;
}

/** Push current card settings to the sheet so they survive cold starts. */
export async function saveCardConfig(db = getDb()) {
  if (!writesEnabled()) return false;
  const { setConfig } = await import('./sheets.js');
  const cards = db.prepare('SELECT * FROM cards').all();
  await setConfig('cards', JSON.stringify(cards));
  return true;
}
