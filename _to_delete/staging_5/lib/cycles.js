import { getDb } from './db.js';

// ---------------------------------------------------------------------------
// Statement cycle engine (spec §3.1–3.2)
// ---------------------------------------------------------------------------

function atEndOfDay(y, m, d) { return new Date(y, m, d, 23, 59, 59, 999); }

/**
 * Latest statement end (day-of-month billDate) that is <= now, plus surrounding
 * cycle dates. Due date uses the real dueDay + dueCycle ('same'|'next' month,
 * from Card_Settings) when provided, otherwise falls back to statementEnd +
 * graceDays.
 */
export function cycleDates(billDate, graceDays, now = new Date(), dueDay = null, dueCycle = 'same') {
  let y = now.getFullYear(), m = now.getMonth();
  let end = atEndOfDay(y, m, billDate);
  if (end > now) { m -= 1; if (m < 0) { m = 11; y -= 1; } end = atEndOfDay(y, m, billDate); }
  let py = y, pm = m - 1; if (pm < 0) { pm = 11; py -= 1; }
  const prevEnd = atEndOfDay(py, pm, billDate);
  const cycleStart = new Date(prevEnd.getTime() + 1);

  let dueDate;
  if (dueDay) {
    let dy = end.getFullYear(), dm = end.getMonth();
    if (dueCycle === 'next') { dm += 1; if (dm > 11) { dm = 0; dy += 1; } }
    dueDate = new Date(dy, dm, dueDay, 23, 59, 59, 999);
  } else {
    dueDate = new Date(end.getFullYear(), end.getMonth(), end.getDate() + graceDays, 23, 59, 59, 999);
  }

  let ny = y, nm = m + 1; if (nm > 11) { nm = 0; ny += 1; }
  const nextEnd = atEndOfDay(ny, nm, billDate);
  return { statementEnd: end, cycleStart, dueDate, nextStatementEnd: nextEnd };
}

function iso(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Compute the full Statement View row for one card.
 * Future-dated rows (pre-logged EMI installments) are excluded until their date arrives.
 */
export function cardStatement(card, now = new Date()) {
  const db = getDb();
  const { statementEnd, cycleStart, dueDate } = cycleDates(
    card.bill_date, card.grace_days, now, card.due_day || null, card.due_cycle || 'same'
  );
  const nowIso = iso(now), endIso = iso(statementEnd);

  // Opening balance: carried debt on the track-start date. Transactions before
  // track-start are excluded (the opening balance stands in for them) so the
  // full pre-tracking history doesn't double-count. Absent → count everything.
  const trackIso = card.opening_date ? `${card.opening_date}T00:00:00` : null;
  const B = card.opening_balance || 0;

  const sum = (where, params) => {
    let w = `deleted=0 AND amount IS NOT NULL AND ${where}`;
    const p = [...params];
    if (trackIso) { w += ' AND ts>=?'; p.push(trackIso); }
    return db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE ${w}`).get(...p).s;
  };

  // Debt accumulated / payments applied up to statement end → closing (billed) balance
  const debtThroughEnd = sum("card_affected=? AND card_direction='debt+' AND ts<=?", [card.name, endIso]);
  const paidThroughEnd = sum("card_affected=? AND card_direction='debt-' AND ts<=?", [card.name, endIso]);
  const billedClosing = B + debtThroughEnd - paidThroughEnd;

  // After statement, up to now
  const spendsAfter = sum("card_affected=? AND card_direction='debt+' AND ts>? AND ts<=?", [card.name, endIso, nowIso]);
  const paymentsAfter = sum("card_affected=? AND card_direction='debt-' AND ts>? AND ts<=?", [card.name, endIso, nowIso]);

  const billPositive = Math.max(0, billedClosing);
  const appliedToBill = Math.min(paymentsAfter, billPositive);
  const remainingDueBill = billPositive - appliedToBill;
  const unbilled = spendsAfter - (paymentsAfter - appliedToBill) + Math.min(0, billedClosing);
  const totalDebtLive = billedClosing + spendsAfter - paymentsAfter;

  // Credit-Given exclusions (approximation: subtract credit-given debt in same windows)
  const cgThroughEnd = sum("card_affected=? AND card_direction='debt+' AND category='Credit Given' AND ts<=?", [card.name, endIso]);
  const cgAfter = sum("card_affected=? AND card_direction='debt+' AND category='Credit Given' AND ts>? AND ts<=?", [card.name, endIso, nowIso]);
  const remainingDueExcl = Math.max(0, remainingDueBill - cgThroughEnd);
  const totalDebtExcl = totalDebtLive - cgThroughEnd - cgAfter + (paidThroughEnd ? Math.min(cgThroughEnd, paidThroughEnd) : 0);

  const daysLeft = Math.ceil((dueDate - now) / 86400000);
  let status = 'Safe';
  if (remainingDueBill <= 0.005) status = 'Paid';
  else if (daysLeft < 0) status = 'Overdue';
  else if (daysLeft <= 5) status = 'Due Soon';

  // Cycle math block (per-card panel)
  const debtThroughStart = sum("card_affected=? AND card_direction='debt+' AND ts<?", [card.name, iso(cycleStart)]);
  const paidThroughStart = sum("card_affected=? AND card_direction='debt-' AND ts<?", [card.name, iso(cycleStart)]);
  const openingBalance = B + debtThroughStart - paidThroughStart;
  const cycleSpends = sum("card_affected=? AND card_direction='debt+' AND ts>=? AND ts<=?", [card.name, iso(cycleStart), endIso]);
  const cycleRepayments = sum("card_affected=? AND card_direction='debt-' AND ts>=? AND ts<=?", [card.name, iso(cycleStart), endIso]);

  return {
    card: card.name,
    color: card.color,
    creditLimit: card.credit_limit,
    statementEnd: iso(statementEnd),
    cycleStart: iso(cycleStart),
    dueDate: iso(dueDate),
    daysLeft,
    remainingDueBill: round2(remainingDueBill),
    totalDebtLive: round2(totalDebtLive),
    unbilled: round2(unbilled),
    remainingDueExcl: round2(remainingDueExcl),
    totalDebtExcl: round2(totalDebtExcl),
    utilization: card.credit_limit > 0 ? totalDebtLive / card.credit_limit : null,
    status,
    cycleMath: {
      openingBalance: round2(openingBalance),
      cycleSpends: round2(cycleSpends),
      cycleRepayments: round2(cycleRepayments),
      closingBalance: round2(openingBalance + cycleSpends - cycleRepayments),
    },
  };
}

export function statementView(now = new Date()) {
  const db = getDb();
  const cards = db.prepare('SELECT * FROM cards WHERE active=1 ORDER BY name').all();
  const rows = cards.map((c) => cardStatement(c, now));
  const totals = {
    remainingDueBill: round2(rows.reduce((a, r) => a + r.remainingDueBill, 0)),
    totalDebtLive: round2(rows.reduce((a, r) => a + r.totalDebtLive, 0)),
    unbilled: round2(rows.reduce((a, r) => a + r.unbilled, 0)),
    remainingDueExcl: round2(rows.reduce((a, r) => a + r.remainingDueExcl, 0)),
    totalDebtExcl: round2(rows.reduce((a, r) => a + r.totalDebtExcl, 0)),
    limits: rows.reduce((a, r) => a + (r.creditLimit || 0), 0),
  };
  totals.utilization = totals.limits > 0 ? totals.totalDebtLive / totals.limits : null;
  return { rows, totals };
}

function round2(n) { return Math.round(n * 100) / 100; }
