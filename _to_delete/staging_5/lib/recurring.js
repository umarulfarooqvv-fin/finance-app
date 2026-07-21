import crypto from 'crypto';
import { getDb } from './db.js';
import { writesEnabled, getConfig, setConfig } from './sheets.js';

// ---------------------------------------------------------------------------
// Recurring expenses: EMIs, subscriptions, any monthly item.
//
// Two sources of "upcoming":
//  1. User-defined recurring definitions (stored in settings + mirrored to the
//     sheet's AppConfig tab so they survive serverless cold starts).
//     Occurrences with date <= today that have no matching transaction are
//     "due to post" — one tap appends them to the sheet. Future ones stay
//     "upcoming" and are never counted anywhere.
//  2. Future-dated rows already pre-logged in the sheet (e.g. Ipad Mini EMIs
//     through Feb-27). The engine already ignores them until their date
//     arrives; here they're surfaced as an "upcoming (in sheet)" schedule.
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'recurring_defs';

export function getDefs(db = getDb()) {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(SETTINGS_KEY);
  try { return r ? JSON.parse(r.value) : []; } catch { return []; }
}

export async function saveDefs(defs, db = getDb()) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)')
    .run(SETTINGS_KEY, JSON.stringify(defs));
  if (writesEnabled()) {
    await setConfig('recurring', JSON.stringify(defs)).catch(() => {});
  }
}

/** Pull defs from the sheet's AppConfig (cold-start hydration). */
export async function loadDefsFromSheet(db = getDb()) {
  const r = await getConfig('recurring');
  if (!r || !r.value) return 0;
  const defs = JSON.parse(r.value);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)')
    .run(SETTINGS_KEY, r.value);
  return defs.length;
}

export function newDef({ name, amount, method, category, remarks, dayOfMonth, firstDate, months }) {
  return {
    id: crypto.randomBytes(6).toString('hex'),
    name: String(name).trim(),
    amount: Number(amount),
    method, category,
    remarks: remarks || name, // may contain {n}/{m} for EMI counters
    dayOfMonth: dayOfMonth ? Number(dayOfMonth) : new Date(`${firstDate}T00:00:00`).getDate(),
    firstDate, // YYYY-MM-DD of first occurrence
    months: months ? Number(months) : null, // total installments; null = open-ended
    createdAt: new Date().toISOString(),
  };
}

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function occurrenceDate(def, k) {
  const f = new Date(`${def.firstDate}T00:00:00`);
  const y = f.getFullYear(), m = f.getMonth() + k;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(def.dayOfMonth, daysInMonth));
}

function renderRemarks(def, k) {
  const n = k + 1;
  return def.remarks.replace(/\{n\}/g, String(n)).replace(/\{m\}/g, String(def.months || ''));
}

/** Was occurrence k already recorded? Match: same calendar month + remarks/name. */
function isPosted(db, def, k) {
  const d = occurrenceDate(def, k);
  const from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01T00:00:00`;
  const to = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-31T23:59:59`;
  const needle = `%${def.name.trim()}%`;
  const row = db.prepare(`
    SELECT COUNT(*) c FROM transactions
    WHERE deleted=0 AND ts>=? AND ts<=? AND remarks LIKE ? COLLATE NOCASE
  `).get(from, to, needle);
  return row.c > 0;
}

/** Full status for one definition. */
export function defStatus(def, db = getDb(), today = new Date(), horizon = 12) {
  const todayIso = isoDate(today);
  const total = def.months || null;
  const out = { ...def, occurrences: [], postedCount: 0, due: [], nextUpcoming: null, finished: false };

  const maxK = total ?? 600; // open-ended scans until enough future shown
  let upcomingShown = 0;
  for (let k = 0; k < maxK; k++) {
    const dIso = isoDate(occurrenceDate(def, k));
    const posted = isPosted(db, def, k);
    let status;
    if (posted) { status = 'posted'; out.postedCount++; }
    else if (dIso <= todayIso) status = 'due';
    else status = 'upcoming';

    const occ = { k, date: dIso, status, remarks: renderRemarks(def, k) };
    out.occurrences.push(occ);
    if (status === 'due') out.due.push(occ);
    if (status === 'upcoming') {
      if (!out.nextUpcoming) out.nextUpcoming = occ;
      upcomingShown++;
      if (upcomingShown >= (total ? horizon : 3)) break;
    }
  }
  if (total && out.postedCount >= total) out.finished = true;
  return out;
}

/** Future-dated rows already pre-logged in the sheet, grouped into series. */
export function sheetUpcoming(db = getDb(), today = new Date()) {
  const nowIso = `${isoDate(today)}T23:59:59`;
  const rows = db.prepare(`
    SELECT id, ts, amount, method, category, remarks FROM transactions
    WHERE deleted=0 AND ts > ? ORDER BY ts ASC
  `).all(nowIso);
  const groups = new Map();
  for (const r of rows) {
    // series key: remarks minus installment counter & fee suffixes
    const key = (r.remarks || '(no remarks)')
      .replace(/\d{1,2}\s*\/\s*\d{1,2}/, '').replace(/\b(charge|surcharge|tax)\b/gi, '')
      .trim() || '(no remarks)';
    if (!groups.has(key)) groups.set(key, { series: key, items: [], total: 0 });
    const g = groups.get(key);
    g.items.push({ id: r.id, date: r.ts.slice(0, 10), amount: r.amount, method: r.method, category: r.category, remarks: r.remarks });
    g.total += r.amount || 0;
  }
  return [...groups.values()].map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }));
}

export function recurringOverview(db = getDb()) {
  const defs = getDefs(db).map((d) => defStatus(d, db));
  return {
    defs,
    dueCount: defs.reduce((a, d) => a + d.due.length, 0),
    sheetUpcoming: sheetUpcoming(db),
  };
}

/** Data needed to post occurrence k of def to the sheet. */
export function buildPostRow(def, k) {
  const d = occurrenceDate(def, k);
  return {
    timestamp: `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} 12:00:00`,
    amount: def.amount,
    method: def.method,
    category: def.category,
    remarks: renderRemarks(def, k),
  };
}
