/* ===========================================================================
   Dry run: what would syncing the Daily Spent sheet actually change?

   Run:
     node --import ./scripts/register-alias.mjs --env-file=.env.local \
          scripts/sheet-diff.mjs

   This writes nothing. It exists because v2's row ids were derived partly from
   the sheet's ROW INDEX, so they cannot be reproduced once rows shift — a
   re-import keyed on them would insert every row again and duplicate the whole
   ledger. Matching therefore happens on the natural key of a transaction:
   when, how much, how, and what for.

   It is a MULTISET comparison, not a set comparison. Two identical ₹10 rows on
   one day are legitimate — the live data contains such a pair — so N copies in
   the sheet must match N copies in the database, and the N+1th is genuinely new.
   =========================================================================== */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseTimestamp } from '@/lib/classify.ts';
import { round2 } from '@/lib/money.ts';

const SEP = String.fromCharCode(31); // unit separator: cannot occur in the data

const URL_ = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === String.fromCharCode(10)) { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== String.fromCharCode(13)) field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = (s) => String(s ?? '').trim();
const amountOf = (a) => {
  const n = Number(String(a).replace(/,/g, '').trim());
  return String(a).trim() === '' || !Number.isFinite(n) ? null : round2(n);
};
/* Matching happens at DAY level, not to the second.
   The sheet's CSV export renders older rows in a date-only display format, so
   a transaction the database holds as 2026-07-21T15:41:45 comes back as
   2026-07-21T00:00:00. Comparing the full instant would call every one of
   those a new row and duplicate it — while replacing a real time with
   midnight. The export is LOWER fidelity than the database here, so the
   database's timestamp wins and the day is what identifies the row. */
const dayOfTs = (ts) => (ts ? String(ts).slice(0, 10) : 'NULL');

const naturalKey = (ts, amount, method, category, remarks) =>
  [dayOfTs(ts), amount ?? 'NULL', norm(method), norm(category), norm(remarks)].join(SEP);

/* A looser key for spotting an EDIT: same day, same description. If the
   amount, method or category then differs, the sheet was corrected after the
   import and the database is stale — that is an update, never an insert. */
const editKey = (ts, remarks) => [dayOfTs(ts), norm(remarks)].join(SEP);

export async function loadSheet(path) {
  const csv = parseCsv(readFileSync(path, 'utf8'));
  const rows = [];
  let unparseable = 0;
  for (let i = 1; i < csv.length; i++) {
    const [ts = '', amt = '', method = '', category = '', remarks = ''] = csv[i] ?? [];
    if (![ts, amt, method, category, remarks].some((c) => c.trim())) continue;
    const parsed = parseTimestamp(ts);
    if (!parsed) unparseable++;
    rows.push({
      sheetRow: i + 1,
      tsRaw: ts,
      ts: parsed?.ts ?? null,
      amount: amountOf(amt),
      method: norm(method),
      category: norm(category),
      remarks: norm(remarks),
    });
  }
  return { rows, unparseable };
}

export async function loadDb() {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const res = await fetch(
      `${URL_}/rest/v1/transactions?select=id,ts,amount,method,category,remarks,deleted&limit=1000&offset=${off}`,
      { headers: H, cache: 'no-store' },
    );
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export function diff(sheetRows, dbRows) {
  const norm2 = (r) => ({
    ...r,
    amount: r.amount === null ? null : round2(Number(r.amount)),
  });
  const db = dbRows.map(norm2);

  // Pass 1 — exact match on the natural key (day + amount + method + category
  // + remarks). Multiset, so genuine duplicates pair off one for one.
  const pool = new Map();
  for (const r of db) {
    const k = naturalKey(r.ts, r.amount, r.method, r.category, r.remarks);
    pool.set(k, [...(pool.get(k) ?? []), r]);
  }

  const unmatched = [];
  const matchedDbIds = new Set();
  for (const s of sheetRows) {
    const k = naturalKey(s.ts, s.amount, s.method, s.category, s.remarks);
    const bucket = pool.get(k);
    if (bucket && bucket.length) {
      matchedDbIds.add(bucket.shift().id);
    } else {
      unmatched.push(s);
    }
  }

  // Pass 2 — of what is left, which are edits of a row we already hold?
  const byEditKey = new Map();
  for (const r of db) {
    if (matchedDbIds.has(r.id)) continue;
    const k = editKey(r.ts, r.remarks);
    byEditKey.set(k, [...(byEditKey.get(k) ?? []), r]);
  }

  const toUpdate = [];
  const toInsert = [];
  for (const s of unmatched) {
    const bucket = byEditKey.get(editKey(s.ts, s.remarks));
    if (bucket && bucket.length) {
      const before = bucket.shift();
      matchedDbIds.add(before.id);
      const changes = [];
      if (before.amount !== s.amount) changes.push(`amount ${before.amount} -> ${s.amount}`);
      if (norm(before.method) !== s.method) changes.push(`method ${before.method} -> ${s.method}`);
      if (norm(before.category) !== s.category) changes.push(`category ${before.category} -> ${s.category}`);
      toUpdate.push({ before, after: s, changes });
    } else {
      toInsert.push(s);
    }
  }

  const orphans = db.filter((r) => !matchedDbIds.has(r.id));
  return { toInsert, toUpdate, orphans };
}

// --- report ----------------------------------------------------------------
// pathToFileURL rather than string concatenation: this project's path contains
// a space, which percent-encodes and never matches a naive comparison.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMain) {
  const { rows: sheet, unparseable } = await loadSheet(process.argv[2] ?? '.scratch-sheet.csv');
  const db = await loadDb();
  const { toInsert, toUpdate, orphans } = diff(sheet, db);

  console.log('sheet rows (non-blank)   :', sheet.length);
  console.log('  unparseable timestamps :', unparseable);
  console.log('database rows            :', db.length);
  console.log('');
  console.log('MATCHED (unchanged)      :', sheet.length - toInsert.length - toUpdate.length);
  console.log('EDITED in the sheet      :', toUpdate.length);
  console.log('NEW -> would be inserted :', toInsert.length);
  console.log('In DB, absent from sheet :', orphans.length);

  if (toUpdate.length) {
    console.log('\n--- edited in the sheet since the import ---');
    for (const u of toUpdate) {
      console.log(`  ${u.before.ts}  ${String(u.after.remarks).slice(0, 32).padEnd(34)} ${u.changes.join('; ')}`);
    }
  }

  console.log('\n--- every row that would be inserted ---');
  for (const r of toInsert) {
    console.log(
      `  ${String(r.sheetRow).padStart(4)}  ${(r.ts ?? 'UNPARSED').padEnd(19)}` +
      ` ${String(r.amount ?? 'NULL').padStart(10)}  ${r.method.padEnd(11)}` +
      ` ${r.category.padEnd(14)} ${r.remarks.slice(0, 34)}`,
    );
  }

  const sum = toInsert.reduce((a, r) => a + (r.amount ?? 0), 0);
  console.log(`\n  new rows total value: ${round2(sum).toLocaleString('en-IN')}`);
  const dated = toInsert.filter((r) => r.ts).map((r) => r.ts).sort();
  console.log(`  date range: ${dated[0] ?? '-'} .. ${dated[dated.length - 1] ?? '-'}`);

  if (orphans.length) {
    console.log('\n--- in the database, absent from the sheet ---');
    console.log('    (never deleted by a sync — only ever reported)');
    for (const r of orphans.slice(0, 20)) {
      console.log(`  ${r.ts}  ${String(r.amount).padStart(10)}  ${r.method} | ${r.category} | ${String(r.remarks).slice(0, 34)}`);
    }
    if (orphans.length > 20) console.log(`  ...and ${orphans.length - 20} more`);
  }
}
