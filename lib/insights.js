import { getDb } from './db.js';
import { displayCategory } from './analytics.js';

// ---------------------------------------------------------------------------
// Extra analytics (spec §3.4 leftovers + insights):
//   - Trip rollups: spend grouped by (Trip <name>) remark tag.
//   - Calendar heatmap: daily spend totals for the last N months.
//   - Anomalies: this month's transactions that are unusually large for their
//     category versus the trailing 3-month baseline, plus categories pacing
//     well above their trailing average.
// ---------------------------------------------------------------------------

const r2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

function parseTags(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

/** Spend grouped by trip tag (from remarks like "(Trip Ponnani to Ernakulam)"). */
export function tripRollups(db = getDb(), now = new Date()) {
  const nowIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:59:59`;
  const rows = db
    .prepare(
      `SELECT ts, amount, method, category, remarks, tags, kind FROM transactions
       WHERE deleted=0 AND amount IS NOT NULL AND ts<=? AND tags LIKE '%"trip"%'
       ORDER BY ts ASC`
    )
    .all(nowIso);

  const trips = new Map();
  for (const row of rows) {
    const trip = parseTags(row.tags).trip;
    if (!trip) continue;
    if (!trips.has(trip)) trips.set(trip, { trip, total: 0, count: 0, byCategory: {}, first: row.ts, last: row.ts });
    const t = trips.get(trip);
    t.total += row.amount;
    t.count += 1;
    const c = displayCategory(row);
    t.byCategory[c] = r2((t.byCategory[c] || 0) + row.amount);
    if (row.ts < t.first) t.first = row.ts;
    if (row.ts > t.last) t.last = row.ts;
  }
  return [...trips.values()]
    .map((t) => ({
      ...t,
      total: r2(t.total),
      from: t.first ? t.first.slice(0, 10) : null,
      to: t.last ? t.last.slice(0, 10) : null,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Daily spend totals for a calendar heatmap, for the last `months` months. */
export function spendHeatmap(db = getDb(), months = 6, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const startIso = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01T00:00:00`;
  const nowIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:59:59`;
  const rows = db
    .prepare(
      `SELECT ts, amount, kind FROM transactions
       WHERE deleted=0 AND amount IS NOT NULL AND ts>=? AND ts<=? AND kind != 'card_payment'`
    )
    .all(startIso, nowIso);
  const byDay = new Map();
  for (const t of rows) {
    const d = t.ts.slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + t.amount);
  }
  const days = [...byDay.entries()].map(([date, total]) => ({ date, total: r2(total) })).sort((a, b) => a.date.localeCompare(b.date));
  const max = days.reduce((m, d) => Math.max(m, d.total), 0);
  return { from: startIso.slice(0, 10), to: nowIso.slice(0, 10), max: r2(max), days };
}

/** Unusually large spends this month vs the trailing 3-month per-category baseline. */
export function anomalies(db = getDb(), now = new Date()) {
  const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const curFrom = `${monthPrefix}-01T00:00:00`;
  const curTo = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:59:59`;
  const baseStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const baseFrom = `${baseStart.getFullYear()}-${pad(baseStart.getMonth() + 1)}-01T00:00:00`;

  const q = (from, to) =>
    db
      .prepare(
        `SELECT id, ts, amount, method, category, remarks, kind FROM transactions
         WHERE deleted=0 AND amount IS NOT NULL AND ts>=? AND ts<? AND kind != 'card_payment'`
      )
      .all(from, to);

  // Baseline stats per display-category from the 3 months before this one.
  const baseline = q(baseFrom, curFrom);
  const stats = {};
  for (const t of baseline) {
    const c = displayCategory(t);
    (stats[c] = stats[c] || []).push(t.amount);
  }
  const catStat = {};
  for (const [c, arr] of Object.entries(stats)) {
    const mean = arr.reduce((a, x) => a + x, 0) / arr.length;
    const variance = arr.reduce((a, x) => a + (x - mean) ** 2, 0) / arr.length;
    catStat[c] = { mean, std: Math.sqrt(variance), n: arr.length };
  }

  const flagged = [];
  for (const t of q(curFrom, curTo)) {
    const c = displayCategory(t);
    const s = catStat[c];
    if (!s || s.n < 3) continue;
    const threshold = s.mean + 2 * s.std;
    if (t.amount > threshold && t.amount > s.mean * 1.5 && t.amount >= 200) {
      flagged.push({
        id: t.id,
        date: t.ts.slice(0, 10),
        amount: r2(t.amount),
        category: c,
        method: t.method,
        remarks: t.remarks,
        typical: r2(s.mean),
        ratio: r2(t.amount / (s.mean || 1)),
      });
    }
  }
  flagged.sort((a, b) => b.ratio - a.ratio);
  return flagged;
}

export function insightsOverview(db = getDb(), now = new Date()) {
  return {
    trips: tripRollups(db, now),
    heatmap: spendHeatmap(db, 6, now),
    anomalies: anomalies(db, now),
  };
}
