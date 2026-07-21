import crypto from 'crypto';
import { getDb } from './db.js';
import { writesEnabled, getConfig, setConfig } from './sheets.js';

// ---------------------------------------------------------------------------
// Savings & Investment ledgers (spec §3.8) and Freelance/Cirqle invoices (§3.9).
//
// Both are simple manual CRUD tables. Because the app's SQLite is a disposable
// cache on Vercel, the rows are mirrored to the sheet's AppConfig ('holdings',
// 'invoices') on every change and rehydrated on cold start — same durability
// pattern as card settings and recurring defs.
// ---------------------------------------------------------------------------

const r2 = (n) => Math.round(n * 100) / 100;
const now = () => new Date().toISOString();
const id = () => crypto.randomBytes(8).toString('hex');

// ---- Holdings (savings + investments) -------------------------------------

export function listHoldings(db = getDb()) {
  const rows = db.prepare('SELECT * FROM holdings WHERE active=1 ORDER BY kind, name').all();
  const totals = { savings: 0, investment: 0, invested: 0, currentValue: 0, gain: 0, goalTarget: 0 };
  const holdings = rows.map((h) => {
    totals[h.kind] = r2((totals[h.kind] || 0) + h.current_value);
    totals.invested = r2(totals.invested + h.invested);
    totals.currentValue = r2(totals.currentValue + h.current_value);
    const target = h.target || 0;
    if (target > 0) totals.goalTarget = r2(totals.goalTarget + target);
    return {
      ...h,
      target,
      goalProgress: target > 0 ? Math.min(1, h.current_value / target) : null,
      goalRemaining: target > 0 ? r2(Math.max(0, target - h.current_value)) : null,
    };
  });
  totals.gain = r2(totals.currentValue - totals.invested);
  return { holdings, totals };
}

export async function upsertHolding(input, db = getDb()) {
  const h = {
    id: input.id || id(),
    kind: input.kind === 'investment' ? 'investment' : 'savings',
    name: String(input.name || '').trim(),
    institution: (input.institution || '').trim() || null,
    invested: Number(input.invested) || 0,
    current_value: input.current_value != null ? Number(input.current_value) : Number(input.invested) || 0,
    target: Number(input.target) || 0,
    note: (input.note || '').trim() || null,
    updated_at: now(),
    active: 1,
  };
  if (!h.name) throw new Error('Name required');
  db.prepare(
    `INSERT INTO holdings (id, kind, name, institution, invested, current_value, target, note, updated_at, active)
     VALUES (@id,@kind,@name,@institution,@invested,@current_value,@target,@note,@updated_at,@active)
     ON CONFLICT(id) DO UPDATE SET kind=@kind, name=@name, institution=@institution,
       invested=@invested, current_value=@current_value, target=@target, note=@note, updated_at=@updated_at, active=1`
  ).run(h);
  await persistHoldings(db).catch(() => {});
  return h;
}

export async function deleteHolding(hid, db = getDb()) {
  db.prepare('UPDATE holdings SET active=0, updated_at=? WHERE id=?').run(now(), hid);
  await persistHoldings(db).catch(() => {});
}

export async function persistHoldings(db = getDb()) {
  if (!writesEnabled()) return false;
  const rows = db.prepare('SELECT * FROM holdings WHERE active=1').all();
  await setConfig('holdings', JSON.stringify(rows));
  return true;
}

export async function loadHoldingsFromSheet(db = getDb()) {
  const r = await getConfig('holdings');
  if (!r || !r.value) return 0;
  const rows = JSON.parse(r.value);
  const up = db.prepare(
    `INSERT INTO holdings (id, kind, name, institution, invested, current_value, target, note, updated_at, active)
     VALUES (@id,@kind,@name,@institution,@invested,@current_value,@target,@note,@updated_at,@active)
     ON CONFLICT(id) DO UPDATE SET kind=@kind, name=@name, institution=@institution,
       invested=@invested, current_value=@current_value, target=@target, note=@note, updated_at=@updated_at, active=@active`
  );
  for (const row of rows) up.run({ active: 1, institution: null, note: null, target: 0, ...row });
  return rows.length;
}

// ---- Invoices (freelance / Cirqle) ----------------------------------------

export function listInvoices(db = getDb()) {
  const rows = db.prepare("SELECT * FROM invoices ORDER BY COALESCE(issued,'') DESC").all();
  const byClient = new Map();
  const totals = { draft: 0, sent: 0, paid: 0, outstanding: 0, total: 0 };
  for (const inv of rows) {
    totals[inv.status] = r2((totals[inv.status] || 0) + inv.amount);
    totals.total = r2(totals.total + inv.amount);
    if (inv.status !== 'paid') totals.outstanding = r2(totals.outstanding + inv.amount);
    if (!byClient.has(inv.client)) byClient.set(inv.client, { client: inv.client, total: 0, outstanding: 0, count: 0 });
    const c = byClient.get(inv.client);
    c.total = r2(c.total + inv.amount);
    if (inv.status !== 'paid') c.outstanding = r2(c.outstanding + inv.amount);
    c.count++;
  }
  return { invoices: rows, clients: [...byClient.values()].sort((a, b) => b.total - a.total), totals };
}

export async function upsertInvoice(input, db = getDb()) {
  const inv = {
    id: input.id || id(),
    client: String(input.client || '').trim(),
    number: (input.number || '').trim() || null,
    amount: Number(input.amount) || 0,
    issued: input.issued || null,
    due: input.due || null,
    status: ['draft', 'sent', 'paid'].includes(input.status) ? input.status : 'draft',
    note: (input.note || '').trim() || null,
    updated_at: now(),
  };
  if (!inv.client) throw new Error('Client required');
  db.prepare(
    `INSERT INTO invoices (id, client, number, amount, issued, due, status, note, updated_at)
     VALUES (@id,@client,@number,@amount,@issued,@due,@status,@note,@updated_at)
     ON CONFLICT(id) DO UPDATE SET client=@client, number=@number, amount=@amount, issued=@issued,
       due=@due, status=@status, note=@note, updated_at=@updated_at`
  ).run(inv);
  await persistInvoices(db).catch(() => {});
  return inv;
}

export async function deleteInvoice(iid, db = getDb()) {
  db.prepare('DELETE FROM invoices WHERE id=?').run(iid);
  await persistInvoices(db).catch(() => {});
}

export async function persistInvoices(db = getDb()) {
  if (!writesEnabled()) return false;
  const rows = db.prepare('SELECT * FROM invoices').all();
  await setConfig('invoices', JSON.stringify(rows));
  return true;
}

export async function loadInvoicesFromSheet(db = getDb()) {
  const r = await getConfig('invoices');
  if (!r || !r.value) return 0;
  const rows = JSON.parse(r.value);
  const up = db.prepare(
    `INSERT INTO invoices (id, client, number, amount, issued, due, status, note, updated_at)
     VALUES (@id,@client,@number,@amount,@issued,@due,@status,@note,@updated_at)
     ON CONFLICT(id) DO UPDATE SET client=@client, number=@number, amount=@amount, issued=@issued,
       due=@due, status=@status, note=@note, updated_at=@updated_at`
  );
  for (const row of rows) up.run(row);
  return rows.length;
}
