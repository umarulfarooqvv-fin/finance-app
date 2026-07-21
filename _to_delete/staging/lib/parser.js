import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Domain constants
// ---------------------------------------------------------------------------

export const CARD_NAMES = ['Edge', 'One Card', 'ICICI', 'Coral', 'Scapia', 'Super Money'];
// Money sources that are NOT credit cards
export const BANK_METHODS = ['Fi', 'Jupiter', 'Cash', 'Perks'];
export const SPEND_CATEGORIES = [
  'Family', 'Food', 'Fuel', 'Personal', 'Gifts/Donations',
  'Maintenance', 'Entertainment', 'Surcharge', 'Taxes',
];
export const ALL_CATEGORIES = [...SPEND_CATEGORIES, 'Credit Given', ...CARD_NAMES];
export const ALL_METHODS = [...BANK_METHODS, ...CARD_NAMES];

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

// ---------------------------------------------------------------------------
// Timestamp parsing — two formats coexist in the sheet:
//   A) " 08, March 26 at 03:58:47:71 PM"  (form's custom format, centiseconds,
//      2-digit year = 20YY; "12:00:00:00 AM" = date-only convention)
//   B) "5/21/2026 14:13:19"               (plain Sheets format, 24h, from 21-May-26 on)
// All times are IST wall-clock. We store them as ISO strings WITHOUT timezone
// conversion (treat as local wall time) so day boundaries match the sheet.
// ---------------------------------------------------------------------------

const FMT_A = /^\s*(\d{1,2}),\s+([A-Za-z]+)\s+(\d{2})\s+at\s+(\d{1,2}):(\d{2}):(\d{2}):(\d{2})\s*(AM|PM)\s*$/i;
const FMT_B = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/;

export function parseTimestamp(raw) {
  if (!raw || !raw.trim()) return null;
  let m = raw.match(FMT_A);
  if (m) {
    const [, dd, monthName, yy, hh, mi, ss, cc, ampm] = m;
    const month = MONTHS[monthName.toLowerCase()];
    if (month === undefined) return null;
    let hour = parseInt(hh, 10) % 12;
    if (ampm.toUpperCase() === 'PM') hour += 12;
    const dateOnly = hh === '12' && mi === '00' && ss === '00' && cc === '00' && ampm.toUpperCase() === 'AM';
    return {
      date: new Date(2000 + parseInt(yy, 10), month, parseInt(dd, 10), dateOnly ? 0 : hour, parseInt(mi, 10), parseInt(ss, 10), parseInt(cc, 10) * 10),
      dateOnly,
    };
  }
  m = raw.match(FMT_B);
  if (m) {
    const [, mo, dd, yyyy, hh, mi, ss] = m;
    return {
      date: new Date(parseInt(yyyy, 10), parseInt(mo, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(mi, 10), parseInt(ss || '0', 10)),
      dateOnly: false,
    };
  }
  return null;
}

/** Local-naive ISO string (no timezone) so day boundaries match the sheet's IST wall time. */
export function localIso(d) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format a Date back to the sheet's plain format (used when appending rows). */
export function formatSheetTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// Remarks tag extraction
// ---------------------------------------------------------------------------

export function parseRemarkTags(remarks) {
  const tags = {};
  if (!remarks) return tags;
  const trip = remarks.match(/\(Trip\s+([^)]+)\)/i);
  if (trip) tags.trip = trip[1].trim();
  if (/cirqle/i.test(remarks)) tags.cirqle = true;
  const emi = remarks.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (emi) {
    tags.emi = { n: parseInt(emi[1], 10), m: parseInt(emi[2], 10) };
    const name = remarks.slice(0, emi.index).replace(/['’]s?\s*$/i, '').trim();
    if (name) tags.emiName = name.replace(/\bemi\b/gi, '').trim() || name;
    if (/charge|surcharge/i.test(remarks)) tags.emiComponent = 'surcharge';
    else if (/tax/i.test(remarks)) tags.emiComponent = 'tax';
    else tags.emiComponent = 'principal';
  } else if (/\bemi\b/i.test(remarks)) {
    tags.emi = true;
  }
  if (/cleared|repayment|repaid/i.test(remarks)) tags.cleared = true;
  return tags;
}

// ---------------------------------------------------------------------------
// Row classification — the heart of the system (spec §2.2)
// ---------------------------------------------------------------------------

export function classifyRow({ amount, method, category, remarks }) {
  const tags = parseRemarkTags(remarks);
  const isCardMethod = CARD_NAMES.includes(method);
  let kind = 'unknown';
  let cardAffected = null; // { card, direction: 'debt+' | 'debt-' }
  let cardPaid = null;

  if (CARD_NAMES.includes(category)) {
    // Payment TO that card (bill clearance), not a spend.
    kind = 'card_payment';
    cardPaid = category;
    cardAffected = { card: category, direction: 'debt-' };
  } else if (category === 'Credit Given') {
    kind = 'credit_given';
    if (isCardMethod) cardAffected = { card: method, direction: 'debt+' };
  } else if (SPEND_CATEGORIES.includes(category)) {
    kind = 'spend';
    if (isCardMethod) cardAffected = { card: method, direction: 'debt+' };
  }

  if (tags.emi && kind !== 'card_payment') kind = kind === 'unknown' ? 'emi' : kind;

  return { kind, cardAffected, cardPaid, tags, isCardMethod };
}

// ---------------------------------------------------------------------------
// Stable row id
// ---------------------------------------------------------------------------

export function rowHash(rowIndex, rawTimestamp, amount, method, category, remarks) {
  const h = crypto.createHash('sha1');
  h.update([rowIndex, rawTimestamp, amount, method, category, remarks].join(''));
  return h.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// CSV parsing (handles quoted fields with embedded commas/newlines)
// ---------------------------------------------------------------------------

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Turn raw CSV rows into normalized transaction objects. Header row is index 0. */
export function normalizeRows(csvRows) {
  const out = [];
  for (let i = 1; i < csvRows.length; i++) {
    const r = csvRows[i];
    const [tsRaw = '', amtRaw = '', method = '', category = '', remarks = ''] = r;
    const sheetRow = i + 1; // 1-based; header = row 1
    if (!tsRaw.trim() && !amtRaw.trim() && !method.trim() && !category.trim() && !remarks.trim()) continue;
    const ts = parseTimestamp(tsRaw);
    const amount = amtRaw.trim() === '' ? null : parseFloat(amtRaw.replace(/,/g, ''));
    const cls = classifyRow({ amount, method: method.trim(), category: category.trim(), remarks: remarks.trim() });
    out.push({
      id: rowHash(sheetRow, tsRaw, amtRaw, method, category, remarks),
      sheetRow,
      tsRaw,
      ts: ts ? localIso(ts.date) : null,
      dateOnly: ts ? ts.dateOnly : false,
      amount: Number.isFinite(amount) ? amount : null,
      method: method.trim(),
      category: category.trim(),
      remarks: remarks.trim(),
      kind: cls.kind,
      cardAffected: cls.cardAffected ? cls.cardAffected.card : null,
      cardDirection: cls.cardAffected ? cls.cardAffected.direction : null,
      tags: cls.tags,
      needsReview: !ts || amount === null || !Number.isFinite(amount) || cls.kind === 'unknown',
    });
  }
  return out;
}
