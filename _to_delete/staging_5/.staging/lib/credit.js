import { getDb } from './db.js';
import { writesEnabled, getConfig, setConfig } from './sheets.js';

// ---------------------------------------------------------------------------
// Credit Given ledger (spec §3.6):
//  - Given = transactions with category 'Credit Given'.
//  - Status per entry lives in credit_status (open / received / partial) and is
//    mirrored to the sheet's AppConfig so it survives serverless cold starts.
//  - Person = manual assignment if set, else guessed from remarks. Once a
//    person is assigned anywhere, other entries whose remarks contain that
//    name are auto-grouped under it.
//  - Possible repayments = income rows with source 'Credit Return' (and card
//    payments whose remarks mention credit given) — shown as suggestions.
// ---------------------------------------------------------------------------

export function guessPerson(remarks) {
  if (!remarks) return '(unknown)';
  let s = remarks
    .replace(/\(.*?\)/g, ' ')                       // (Trip …) (Cirqle)
    .replace(/\d{1,2}\s*\/\s*\d{1,2}/g, ' ')         // 13/24
    .replace(/\b(emi|charge|surcharge|tax|cleared|repayment|will give.*|to (pay|purchase|transfer|clear).*)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return s || remarks.trim() || '(unknown)';
}

function statusMap(db) {
  const m = new Map();
  for (const r of db.prepare('SELECT * FROM credit_status').all()) m.set(r.tx_id, r);
  return m;
}

/** Known person names (manual assignments), longest first for greedy matching. */
function knownPersons(db) {
  return db.prepare("SELECT DISTINCT person FROM credit_status WHERE person IS NOT NULL AND person<>''")
    .all().map((r) => r.person).sort((a, b) => b.length - a.length);
}

export function creditLedger(db = getDb()) {
  const st = statusMap(db);
  const persons = knownPersons(db);
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const nowIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:59:59`;

  const given = db.prepare(`
    SELECT id, ts, amount, method, remarks FROM transactions
    WHERE deleted=0 AND amount IS NOT NULL AND category='Credit Given' AND ts<=?
    ORDER BY ts DESC
  `).all(nowIso);

  const entries = given.map((g) => {
    const s = st.get(g.id);
    let person = s?.person;
    if (!person) {
      // match ignoring case and spaces, so "Arshad Ali" groups "arshadali" too
      const norm = (x) => (x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const hay = norm(g.remarks);
      const hit = persons.find((p) => hay.includes(norm(p)));
      person = hit || guessPerson(g.remarks);
    }
    const status = s?.status || 'open';
    const receivedAmount = s?.received_amount || 0;
    return {
      id: g.id, date: g.ts ? g.ts.slice(0, 10) : null, amount: g.amount,
      method: g.method, remarks: g.remarks,
      person, personAssigned: Boolean(s?.person),
      status, receivedAmount, receivedAt: s?.received_at || null,
      outstanding: Math.max(0, r2(g.amount - (status === 'received' ? g.amount : receivedAmount))),
    };
  });

  // Group by person
  const byPerson = new Map();
  for (const e of entries) {
    if (!byPerson.has(e.person)) byPerson.set(e.person, { person: e.person, given: 0, received: 0, outstanding: 0, entries: [] });
    const p = byPerson.get(e.person);
    p.given = r2(p.given + e.amount);
    p.received = r2(p.received + (e.status === 'received' ? e.amount : e.receivedAmount));
    p.outstanding = r2(p.outstanding + e.outstanding);
    p.entries.push(e);
  }
  const people = [...byPerson.values()].sort((a, b) => b.outstanding - a.outstanding);

  // Repayment suggestions
  const creditReturns = db.prepare(`
    SELECT id, ts, amount, account, remarks FROM income
    WHERE deleted=0 AND amount IS NOT NULL AND source='Credit Return'
    ORDER BY ts DESC LIMIT 50
  `).all().map((r) => ({ ...r, date: r.ts ? r.ts.slice(0, 10) : null }));
  const clearedViaCard = db.prepare(`
    SELECT id, ts, amount, method, category, remarks FROM transactions
    WHERE deleted=0 AND kind='card_payment' AND remarks LIKE '%credit g%' COLLATE NOCASE
    ORDER BY ts DESC LIMIT 20
  `).all().map((r) => ({ ...r, date: r.ts ? r.ts.slice(0, 10) : null }));

  return {
    totals: {
      given: r2(entries.reduce((a, e) => a + e.amount, 0)),
      received: r2(entries.reduce((a, e) => a + (e.status === 'received' ? e.amount : e.receivedAmount), 0)),
      outstanding: r2(entries.reduce((a, e) => a + e.outstanding, 0)),
      openCount: entries.filter((e) => e.outstanding > 0).length,
    },
    people,
    suggestions: { creditReturns, clearedViaCard },
  };
}

export async function setCreditStatus({ txId, status, receivedAmount, person, note }, db = getDb()) {
  const existing = db.prepare('SELECT * FROM credit_status WHERE tx_id=?').get(txId) || {};
  const next = {
    status: status ?? existing.status ?? 'open',
    received_amount: receivedAmount ?? existing.received_amount ?? 0,
    received_at: status === 'received' || status === 'partial' ? new Date().toISOString() : existing.received_at ?? null,
    person: person !== undefined ? person : existing.person ?? null,
    note: note !== undefined ? note : existing.note ?? null,
  };
  if (next.status === 'open') { next.received_amount = 0; next.received_at = null; }
  db.prepare(`
    INSERT INTO credit_status (tx_id, status, received_amount, received_at, person, note)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(tx_id) DO UPDATE SET status=excluded.status, received_amount=excluded.received_amount,
      received_at=excluded.received_at, person=excluded.person, note=excluded.note
  `).run(txId, next.status, next.received_amount, next.received_at, next.person, next.note);
  await persistCreditStatus(db).catch(() => {});
}

/** Mirror the whole credit_status table to AppConfig (survives cold starts). */
export async function persistCreditStatus(db = getDb()) {
  if (!writesEnabled()) return false;
  const rows = db.prepare('SELECT * FROM credit_status').all();
  await setConfig('credit_status', JSON.stringify(rows));
  return true;
}

export async function loadCreditStatusFromSheet(db = getDb()) {
  const r = await getConfig('credit_status');
  if (!r || !r.value) return 0;
  const rows = JSON.parse(r.value);
  const up = db.prepare(`
    INSERT INTO credit_status (tx_id, status, received_amount, received_at, person, note)
    VALUES (@tx_id, @status, @received_amount, @received_at, @person, @note)
    ON CONFLICT(tx_id) DO UPDATE SET status=@status, received_amount=@received_amount,
      received_at=@received_at, person=@person, note=@note
  `);
  for (const row of rows) up.run(row);
  return rows.length;
}

function r2(n) { return Math.round(n * 100) / 100; }
