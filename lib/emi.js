import { getDb } from './db.js';

// ---------------------------------------------------------------------------
// EMI tracker (spec §3.7)
//
// EMIs are detected from transaction remarks tagged `n/m` (parser stores
// tags = { emi: { n, m }, emiName, emiComponent }). Rows for one EMI item are
// grouped by name; each installment may split into principal + surcharge + tax
// rows. The tracker reports, per item: installment amount, paid n of m,
// remaining count, next due date, the card it bills to, and fee components.
// Future-dated installments (pre-logged in the sheet) drive "next due" and the
// remaining schedule; they are never counted as spend elsewhere.
// ---------------------------------------------------------------------------

const r2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const isoNow = (now) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:59:59`;

function parseTags(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  let bestC = -1;
  for (const [v, c] of counts) if (c > bestC) ((best = v), (bestC = c));
  return best;
}

export function emiItems(db = getDb(), now = new Date()) {
  const nowIso = isoNow(now);
  const rows = db
    .prepare(
      `SELECT id, ts, amount, method, category, remarks, tags FROM transactions
       WHERE deleted=0 AND amount IS NOT NULL AND tags LIKE '%"emi"%'
       ORDER BY ts ASC`
    )
    .all();

  const groups = new Map();
  for (const row of rows) {
    const tags = parseTags(row.tags);
    if (!tags.emi || typeof tags.emi !== 'object') continue; // needs n/m
    const key = (tags.emiName || row.remarks || '(unnamed EMI)').trim() || '(unnamed EMI)';
    if (!groups.has(key)) groups.set(key, { name: key, rows: [] });
    groups.get(key).rows.push({ ...row, tags });
  }

  const items = [];
  for (const g of groups.values()) {
    const principal = g.rows.filter((r) => (r.tags.emiComponent || 'principal') === 'principal');
    const fees = g.rows.filter((r) => r.tags.emiComponent === 'surcharge' || r.tags.emiComponent === 'tax');
    const total = mode(g.rows.map((r) => r.tags.emi.m).filter(Boolean)) || null; // installments total (m)
    const installment = principal.length ? mode(principal.map((r) => r.amount)) : mode(g.rows.map((r) => r.amount));
    const card = mode(g.rows.map((r) => r.method));

    const paid = principal.filter((r) => r.ts && r.ts <= nowIso);
    const future = principal.filter((r) => r.ts && r.ts > nowIso).sort((a, b) => a.ts.localeCompare(b.ts));
    const paidCount = paid.length;
    const remaining = total ? Math.max(0, total - paidCount) : Math.max(0, future.length);
    const nextDue = future[0] || null;

    const feeTotal = fees.reduce((a, r) => a + (r.amount || 0), 0);
    const principalPaid = paid.reduce((a, r) => a + (r.amount || 0), 0);

    items.push({
      name: g.name,
      card,
      installment: installment != null ? r2(installment) : null,
      totalInstallments: total,
      paidCount,
      remaining,
      finished: total ? paidCount >= total : remaining === 0,
      nextDueDate: nextDue ? nextDue.ts.slice(0, 10) : null,
      nextDueAmount: nextDue ? r2(nextDue.amount) : null,
      principalPaid: r2(principalPaid),
      feeTotal: r2(feeTotal),
      estimatedTotal: total && installment != null ? r2(installment * total + feeTotal) : null,
      schedule: g.rows
        .map((r) => ({
          date: r.ts ? r.ts.slice(0, 10) : null,
          n: r.tags.emi.n,
          m: r.tags.emi.m,
          amount: r2(r.amount),
          component: r.tags.emiComponent || 'principal',
          method: r.method,
          posted: r.ts ? r.ts <= nowIso : false,
        }))
        .sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    });
  }

  items.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? 1 : -1;
    return (a.nextDueDate || '9999').localeCompare(b.nextDueDate || '9999');
  });

  const active = items.filter((i) => !i.finished);
  return {
    items,
    totals: {
      count: items.length,
      activeCount: active.length,
      monthlyOutgo: r2(active.reduce((a, i) => a + (i.installment || 0), 0)),
      remainingPrincipal: r2(
        active.reduce((a, i) => a + (i.installment != null && i.remaining ? i.installment * i.remaining : 0), 0)
      ),
    },
  };
}
