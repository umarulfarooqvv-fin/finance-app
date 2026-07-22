import crypto from 'crypto';
import { getDb } from './db.js';
import { writesEnabled, getConfig, setConfig } from './sheets.js';

// ---------------------------------------------------------------------------
// Credit (Taken) — money Farooq has BORROWED (the sheet's "Credit (Taken)" tab).
//
// The mirror image of lib/credit.js (Credit Given). A debt has a lender, a
// principal, and a list of repayments; Balance to Pay = principal − repaid.
// These are real liabilities, so netWorthSnapshot()/netWorthTrend() subtract
// them (before this module net worth silently ignored borrowed money).
//
// Entries are manual — nothing in the transaction log identifies a borrowing —
// so, like holdings/invoices, rows are mirrored into app_config ('debts',
// 'debt_payments') and rehydrated on cold start, because the SQLite side is a
// disposable cache on Vercel.
// ---------------------------------------------------------------------------

const r2 = (n) => Math.round(n * 100) / 100;
const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomBytes(8).toString('hex');
const KINDS = ['personal', 'emi', 'loan', 'other'];

export function listDebts(db = getDb()) {
  const rows = db.prepare('SELECT * FROM debts WHERE active=1 ORDER BY lender').all();
  const pays = db.prepare("SELECT * FROM debt_payments ORDER BY COALESCE(paid_on, '')").all();
  const byDebt = new Map();
  for (const p of pays) {
    if (!byDebt.has(p.debt_id)) byDebt.set(p.debt_id, []);
    byDebt.get(p.debt_id).push(p);
  }

  const totals = { principal: 0, repaid: 0, outstanding: 0, settledCount: 0, openCount: 0 };
  const debts = rows.map((d) => {
    const payments = byDebt.get(d.id) || [];
    const repaid = r2(payments.reduce((a, p) => a + (p.amount || 0), 0));
    const balance = r2(Math.max(0, d.principal - repaid));
    const settled = balance <= 0.005;
    totals.principal = r2(totals.principal + d.principal);
    totals.repaid = r2(totals.repaid + repaid);
    totals.outstanding = r2(totals.outstanding + balance);
    if (settled) totals.settledCount++;
    else totals.openCount++;
    return {
      ...d,
      payments,
      repaid,
      balance,
      settled,
      progress: d.principal > 0 ? Math.min(1, repaid / d.principal) : 0,
    };
  });
  // Biggest balance first; settled debts sink to the bottom.
  debts.sort((a, b) => Number(a.settled) - Number(b.settled) || b.balance - a.balance);
  return { debts, totals };
}

/**
 * Outstanding borrowed money as of a date (YYYY-MM-DD or a full ISO string) —
 * used by the net-worth trend. Debts with no borrowed_on count from the start;
 * payments with no paid_on count immediately (best available information).
 */
export function debtsOutstandingAt(db = getDb(), asOf) {
  const day = String(asOf).slice(0, 10);
  const principal = db
    .prepare(
      `SELECT COALESCE(SUM(principal),0) s FROM debts
       WHERE active=1 AND COALESCE(borrowed_on, '0000-00-00') <= ?`
    )
    .get(day).s;
  const repaid = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount),0) s FROM debt_payments p
       JOIN debts d ON d.id = p.debt_id
       WHERE d.active=1 AND COALESCE(p.paid_on, '0000-00-00') <= ?`
    )
    .get(day).s;
  return r2(Math.max(0, principal - repaid));
}

export async function upsertDebt(input, db = getDb()) {
  const d = {
    id: input.id || newId(),
    lender: String(input.lender || '').trim(),
    principal: Number(input.principal) || 0,
    borrowed_on: input.borrowed_on || null,
    due: input.due || null,
    kind: KINDS.includes(input.kind) ? input.kind : 'personal',
    note: (input.note || '').trim() || null,
    updated_at: nowIso(),
    active: 1,
  };
  if (!d.lender) throw new Error('Lender required');
  db.prepare(
    `INSERT INTO debts (id, lender, principal, borrowed_on, due, kind, note, updated_at, active)
     VALUES (@id,@lender,@principal,@borrowed_on,@due,@kind,@note,@updated_at,@active)
     ON CONFLICT(id) DO UPDATE SET lender=@lender, principal=@principal, borrowed_on=@borrowed_on,
       due=@due, kind=@kind, note=@note, updated_at=@updated_at, active=1`
  ).run(d);
  await persistDebts(db).catch(() => {});
  return d;
}

export async function deleteDebt(id, db = getDb()) {
  db.prepare('UPDATE debts SET active=0, updated_at=? WHERE id=?').run(nowIso(), id);
  await persistDebts(db).catch(() => {});
}

export async function addDebtPayment(input, db = getDb()) {
  const p = {
    id: input.id || newId(),
    debt_id: String(input.debt_id || ''),
    amount: Number(input.amount) || 0,
    paid_on: input.paid_on || nowIso().slice(0, 10),
    note: (input.note || '').trim() || null,
  };
  if (!p.debt_id) throw new Error('debt_id required');
  if (p.amount <= 0) throw new Error('Amount must be positive');
  const exists = db.prepare('SELECT 1 FROM debts WHERE id=? AND active=1').get(p.debt_id);
  if (!exists) throw new Error('Unknown debt');
  db.prepare(
    `INSERT INTO debt_payments (id, debt_id, amount, paid_on, note)
     VALUES (@id,@debt_id,@amount,@paid_on,@note)
     ON CONFLICT(id) DO UPDATE SET debt_id=@debt_id, amount=@amount, paid_on=@paid_on, note=@note`
  ).run(p);
  await persistDebts(db).catch(() => {});
  return p;
}

export async function deleteDebtPayment(id, db = getDb()) {
  db.prepare('DELETE FROM debt_payments WHERE id=?').run(id);
  await persistDebts(db).catch(() => {});
}

export async function persistDebts(db = getDb()) {
  if (!writesEnabled()) return false;
  const debts = db.prepare('SELECT * FROM debts WHERE active=1').all();
  const payments = db
    .prepare('SELECT p.* FROM debt_payments p JOIN debts d ON d.id=p.debt_id WHERE d.active=1')
    .all();
  await Promise.all([
    setConfig('debts', JSON.stringify(debts)),
    setConfig('debt_payments', JSON.stringify(payments)),
  ]);
  return true;
}

export async function loadDebtsFromSheet(db = getDb()) {
  const [d, p] = await Promise.all([getConfig('debts'), getConfig('debt_payments')]);
  const debts = d && d.value ? JSON.parse(d.value) : [];
  const payments = p && p.value ? JSON.parse(p.value) : [];
  const upD = db.prepare(
    `INSERT INTO debts (id, lender, principal, borrowed_on, due, kind, note, updated_at, active)
     VALUES (@id,@lender,@principal,@borrowed_on,@due,@kind,@note,@updated_at,@active)
     ON CONFLICT(id) DO UPDATE SET lender=@lender, principal=@principal, borrowed_on=@borrowed_on,
       due=@due, kind=@kind, note=@note, updated_at=@updated_at, active=@active`
  );
  for (const row of debts) {
    upD.run({
      borrowed_on: null,
      due: null,
      kind: 'personal',
      note: null,
      active: 1,
      updated_at: null,
      ...row,
    });
  }
  const upP = db.prepare(
    `INSERT INTO debt_payments (id, debt_id, amount, paid_on, note)
     VALUES (@id,@debt_id,@amount,@paid_on,@note)
     ON CONFLICT(id) DO UPDATE SET debt_id=@debt_id, amount=@amount, paid_on=@paid_on, note=@note`
  );
  for (const row of payments) upP.run({ paid_on: null, note: null, ...row });
  return debts.length;
}
