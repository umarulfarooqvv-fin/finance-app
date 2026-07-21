import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db;

const DEFAULT_CARDS = [
  // billDate = statement generation day-of-month; graceDays = statement → due
  { name: 'Edge',        billDate: 6,  graceDays: 15, creditLimit: 0, color: '#7c5cff' },
  { name: 'One Card',    billDate: 22, graceDays: 16, creditLimit: 0, color: '#2dd4bf' },
  { name: 'ICICI',       billDate: 5,  graceDays: 18, creditLimit: 0, color: '#f97316' },
  { name: 'Coral',       billDate: 25, graceDays: 17, creditLimit: 0, color: '#ef4444' },
  { name: 'Scapia',      billDate: 14, graceDays: 19, creditLimit: 0, color: '#38bdf8' },
  { name: 'Super Money', billDate: 1,  graceDays: 14, creditLimit: 0, color: '#facc15' },
];

export function getDb() {
  if (db) return db;
  // On Vercel the project dir is read-only and /tmp is the only writable path.
  // The DB there is a disposable cache — it rebuilds from the sheet on cold
  // start (see lib/bootstrap.js); verified flags & card settings live in the
  // sheet (AppMeta / AppConfig tabs), so nothing important is lost.
  const dir = process.env.VERCEL ? '/tmp/finance-data' : path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, 'finance.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      sheet_row INTEGER NOT NULL,
      ts_raw TEXT,
      ts TEXT,
      date_only INTEGER DEFAULT 0,
      amount REAL,
      method TEXT,
      category TEXT,
      remarks TEXT,
      kind TEXT,
      card_affected TEXT,
      card_direction TEXT,
      tags TEXT,
      needs_review INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tx_sheet_row ON transactions(sheet_row);
    CREATE INDEX IF NOT EXISTS idx_tx_ts ON transactions(ts);

    CREATE TABLE IF NOT EXISTS annotations (
      tx_id TEXT PRIMARY KEY,
      verified INTEGER DEFAULT 0,
      verified_at TEXT,
      note TEXT,
      synced_to_sheet INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cards (
      name TEXT PRIMARY KEY,
      bill_date INTEGER NOT NULL,
      grace_days INTEGER NOT NULL,
      credit_limit REAL DEFAULT 0,
      color TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS income (
      id TEXT PRIMARY KEY,
      sheet_row INTEGER NOT NULL,
      ts_raw TEXT,
      ts TEXT,
      amount REAL,
      source TEXT,
      account TEXT,
      remarks TEXT,
      needs_review INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_income_ts ON income(ts);

    CREATE TABLE IF NOT EXISTS accounts (
      name TEXT PRIMARY KEY,
      opening_balance REAL DEFAULT 0,
      color TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS credit_status (
      tx_id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'open',      -- open | received | partial
      received_amount REAL DEFAULT 0,
      received_at TEXT,
      person TEXT,                     -- manual person assignment (overrides guess)
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT DEFAULT (datetime('now','localtime')),
      type TEXT,
      detail TEXT
    );

    -- Manual savings & investment holdings (spec §3.8). kind = 'savings' | 'investment'.
    CREATE TABLE IF NOT EXISTS holdings (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'savings',
      name TEXT NOT NULL,
      institution TEXT,
      invested REAL DEFAULT 0,        -- total contributed
      current_value REAL DEFAULT 0,   -- latest market/redeemable value
      target REAL DEFAULT 0,          -- savings goal target (0 = no goal)
      note TEXT,
      updated_at TEXT,
      active INTEGER DEFAULT 1
    );

    -- Freelance / Cirqle invoices (spec §3.9).
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      client TEXT NOT NULL,
      number TEXT,
      amount REAL DEFAULT 0,
      issued TEXT,                    -- YYYY-MM-DD
      due TEXT,                       -- YYYY-MM-DD
      status TEXT DEFAULT 'draft',    -- draft | sent | paid
      note TEXT,
      updated_at TEXT
    );
  `);
  // Lightweight migrations for columns added after the initial schema.
  for (const [table, col, def] of [['holdings', 'target', 'REAL DEFAULT 0']]) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
  }

  // Seed default cards once
  const count = db.prepare('SELECT COUNT(*) c FROM cards').get().c;
  if (count === 0) {
    const ins = db.prepare('INSERT INTO cards (name, bill_date, grace_days, credit_limit, color, active) VALUES (?,?,?,?,?,1)');
    for (const c of DEFAULT_CARDS) ins.run(c.name, c.billDate, c.graceDays, c.creditLimit, c.color);
  }
  // Seed bank/cash accounts once (opening balances adjustable in-app)
  const acc = db.prepare('SELECT COUNT(*) c FROM accounts').get().c;
  if (acc === 0) {
    const ins = db.prepare('INSERT INTO accounts (name, opening_balance, color, active) VALUES (?,0,?,1)');
    for (const [name, color] of [['Fi', '#22c55e'], ['Jupiter', '#f97316'], ['SBI', '#38bdf8'], ['Cash', '#facc15']]) ins.run(name, color);
  }
  return db;
}

export function logEvent(type, detail) {
  getDb().prepare('INSERT INTO events (type, detail) VALUES (?,?)').run(type, typeof detail === 'string' ? detail : JSON.stringify(detail));
}
