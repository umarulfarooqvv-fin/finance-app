import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db;

// Real settings sourced from the Financial Summary "Card_Settings" tab:
// billDate = statement day-of-month; dueDay + dueCycle ('same'|'next' month) =
// payment due date; creditLimit for utilization; openingBalance = carried debt
// on openingDate (so pre-tracking history isn't double-counted). graceDays kept
// as a fallback for the due date when dueDay is absent.
const DEFAULT_CARDS = [
  {
    name: 'Edge',
    billDate: 6,
    graceDays: 15,
    dueDay: 21,
    dueCycle: 'same',
    creditLimit: 50000,
    openingBalance: 6851.68,
    openingDate: '2025-12-10',
    color: '#7c5cff',
  },
  {
    name: 'One Card',
    billDate: 22,
    graceDays: 16,
    dueDay: 8,
    dueCycle: 'next',
    creditLimit: 115000,
    openingBalance: 858.57,
    openingDate: '2025-12-10',
    color: '#2dd4bf',
  },
  {
    name: 'ICICI',
    billDate: 5,
    graceDays: 18,
    dueDay: 23,
    dueCycle: 'same',
    creditLimit: 50000,
    openingBalance: 5433.13,
    openingDate: '2025-12-10',
    color: '#f97316',
  },
  {
    name: 'Coral',
    billDate: 25,
    graceDays: 17,
    dueDay: 12,
    dueCycle: 'next',
    creditLimit: 50000,
    openingBalance: 2662.72,
    openingDate: '2025-12-15',
    color: '#ef4444',
  },
  {
    name: 'Scapia',
    billDate: 14,
    graceDays: 19,
    dueDay: 3,
    dueCycle: 'next',
    creditLimit: 48000,
    openingBalance: 16951.5,
    openingDate: '2026-01-04',
    color: '#38bdf8',
  },
  {
    name: 'Super Money',
    billDate: 1,
    graceDays: 14,
    dueDay: 15,
    dueCycle: 'same',
    creditLimit: 2452.5,
    openingBalance: 0,
    openingDate: '2025-12-10',
    color: '#facc15',
  },
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
      due_day INTEGER,                 -- payment due day-of-month (from Card_Settings)
      due_cycle TEXT DEFAULT 'same',   -- 'same' | 'next' month relative to statement
      credit_limit REAL DEFAULT 0,
      opening_balance REAL DEFAULT 0,  -- carried debt on opening_date
      opening_date TEXT,               -- track-start date (YYYY-MM-DD)
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

    -- Credit (Taken) — money borrowed from other people (lib/debts.js).
    -- Manual entries; mirrored to app_config like holdings/invoices.
    CREATE TABLE IF NOT EXISTS debts (
      id TEXT PRIMARY KEY,
      lender TEXT NOT NULL,
      principal REAL DEFAULT 0,       -- amount borrowed
      borrowed_on TEXT,               -- YYYY-MM-DD
      due TEXT,                       -- YYYY-MM-DD (optional)
      kind TEXT DEFAULT 'personal',   -- personal | emi | loan | other
      note TEXT,
      updated_at TEXT,
      active INTEGER DEFAULT 1
    );

    -- Repayments against a debt; Balance to Pay = principal − SUM(amount).
    CREATE TABLE IF NOT EXISTS debt_payments (
      id TEXT PRIMARY KEY,
      debt_id TEXT NOT NULL,
      amount REAL DEFAULT 0,
      paid_on TEXT,                   -- YYYY-MM-DD
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments(debt_id);

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
  for (const [table, col, def] of [
    ['holdings', 'target', 'REAL DEFAULT 0'],
    ['cards', 'due_day', 'INTEGER'],
    ['cards', 'due_cycle', "TEXT DEFAULT 'same'"],
    ['cards', 'opening_balance', 'REAL DEFAULT 0'],
    ['cards', 'opening_date', 'TEXT'],
  ]) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch {
      /* already exists */
    }
  }

  // Seed default cards once
  const count = db.prepare('SELECT COUNT(*) c FROM cards').get().c;
  if (count === 0) {
    const ins = db.prepare(
      `INSERT INTO cards (name, bill_date, grace_days, due_day, due_cycle, credit_limit, opening_balance, opening_date, color, active)
       VALUES (@name,@billDate,@graceDays,@dueDay,@dueCycle,@creditLimit,@openingBalance,@openingDate,@color,1)`
    );
    for (const c of DEFAULT_CARDS) ins.run(c);
  } else {
    // One-time populate of real Card_Settings values for cards left unconfigured
    // (credit_limit still 0 from the original defaults). Never overrides a card
    // the user has already given a real limit.
    const upd = db.prepare(
      `UPDATE cards SET bill_date=@billDate, grace_days=@graceDays, due_day=@dueDay, due_cycle=@dueCycle,
         credit_limit=@creditLimit, opening_balance=@openingBalance, opening_date=@openingDate
       WHERE name=@name AND (credit_limit IS NULL OR credit_limit=0)`
    );
    for (const c of DEFAULT_CARDS) upd.run(c);
  }
  // Seed bank/cash accounts once (opening balances adjustable in-app)
  const acc = db.prepare('SELECT COUNT(*) c FROM accounts').get().c;
  if (acc === 0) {
    const ins = db.prepare(
      'INSERT INTO accounts (name, opening_balance, color, active) VALUES (?,0,?,1)'
    );
    for (const [name, color] of [
      ['Fi', '#22c55e'],
      ['Jupiter', '#f97316'],
      ['SBI', '#38bdf8'],
      ['Cash', '#facc15'],
    ])
      ins.run(name, color);
  }

  // Seed savings & investment holdings once, from the Financial Summary
  // Savings/Investment tabs (aggregate starting values — split/refine in-app).
  const hcount = db.prepare('SELECT COUNT(*) c FROM holdings').get().c;
  if (hcount === 0) {
    const ins = db.prepare(
      `INSERT INTO holdings (id, kind, name, institution, invested, current_value, target, note, updated_at, active)
       VALUES (@id,@kind,@name,@institution,@invested,@current_value,@target,@note,@updated_at,1)`
    );
    const seedAt = '2026-07-20T00:00:00.000Z';
    for (const h of [
      {
        id: 'seed-savings',
        kind: 'savings',
        name: 'Savings (all jars)',
        institution: 'Fi',
        invested: 34833,
        current_value: 34833,
        target: 0,
        note: 'Aggregate of Savings tab streams — split as needed',
        updated_at: seedAt,
      },
      {
        id: 'seed-invest-gold',
        kind: 'investment',
        name: 'Gold (Jupiter)',
        institution: 'Jupiter',
        invested: 4239.15,
        current_value: 5605.78,
        target: 0,
        note: 'From Investment tab — 0.3849 g',
        updated_at: seedAt,
      },
      {
        id: 'seed-invest-rest',
        kind: 'investment',
        name: 'FD + Rewards + other',
        institution: null,
        invested: 70240.24,
        current_value: 81421.13,
        target: 0,
        note: 'Investment tab total minus gold — verify',
        updated_at: seedAt,
      },
    ])
      ins.run(h);
  }
  return db;
}

export function logEvent(type, detail) {
  getDb()
    .prepare('INSERT INTO events (type, detail) VALUES (?,?)')
    .run(type, typeof detail === 'string' ? detail : JSON.stringify(detail));
}
