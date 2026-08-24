/* ===========================================================================
   Sync the Daily Spent sheet into Postgres.

     node --import ./scripts/register-alias.mjs --env-file=.env.local \
          scripts/sync-sheet.mjs            # dry run, writes nothing
     ... scripts/sync-sheet.mjs --apply     # writes

   Design decisions, each with a reason:

   INSERTS AND UPDATES ONLY. A sync never deletes. A row present here but
   absent from the sheet is reported, never removed — the sheet is the source
   of truth for what EXISTS, not for what is allowed to survive, and a row
   dropped from a spreadsheet by accident must not silently erase history.

   MATCHING IS AT DAY LEVEL. The sheet's CSV export renders older rows in a
   date-only display format, so a transaction stored as 15:41:45 comes back as
   00:00:00. Comparing full instants would call every one of those new. The
   database's timestamp is the higher-fidelity value and is never overwritten
   with a degraded one.

   IDS ARE CONTENT-DERIVED. Re-running finds the same rows already matched and
   writes nothing, so the script is safe to run repeatedly. The occurrence
   index in the hash means two genuinely identical rows on one day stay two
   rows — the live data contains such a pair.

   DERIVED FIELDS ARE COMPUTED HERE, from the app's own classifier, so a row
   arriving by sync is classified identically to one typed into the app.
   =========================================================================== */

import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { classify } from '@/lib/classify.ts';
import { round2 } from '@/lib/money.ts';
import { diff, loadDb, loadSheet } from './sheet-diff.mjs';

const APPLY = process.argv.includes('--apply');
const CSV = process.argv.find((a) => a.endsWith('.csv')) ?? '.scratch-sheet.csv';

const URL_ = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

if (!URL_ || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.');
  process.exit(1);
}

/** Deterministic id. `n` disambiguates genuinely identical rows on one day. */
function rowId(r, n) {
  const basis = [r.ts?.slice(0, 10) ?? 'NULL', r.amount ?? 'NULL', r.method, r.category, r.remarks, n].join('|');
  return `sheet-${crypto.createHash('sha256').update(basis).digest('hex').slice(0, 24)}`;
}

/** Build the Postgres row, deriving everything derivable. */
function toRow(r, id) {
  const cls = classify({ method: r.method, category: r.category, remarks: r.remarks });
  return {
    id,
    ts: r.ts,
    amount: r.amount === null ? null : round2(r.amount),
    method: r.method,
    category: r.category,
    remarks: r.remarks,
    kind: cls.kind,
    card_affected: cls.cardAffected,
    card_direction: cls.cardDirection,
    tags: cls.tags,
    verified: false,
    // An unparseable date or an unrecognised category is surfaced, never
    // quietly counted.
    needs_review: r.ts === null || r.amount === null || cls.kind === 'unknown' || r.method.trim() === '',
    deleted: false,
    source: 'sheet-sync',
  };
}

async function post(path, body, method = 'POST', prefer) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: prefer ? { ...H, Prefer: prefer } : H,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res;
}

// --- work out what to do ----------------------------------------------------
const { rows: sheet, unparseable } = await loadSheet(CSV);
const db = await loadDb();
const { toInsert, toUpdate, orphans } = diff(sheet, db);

// Assign occurrence indices so identical same-day rows get distinct ids.
const seen = new Map();
const inserts = toInsert.map((r) => {
  const base = [r.ts?.slice(0, 10), r.amount, r.method, r.category, r.remarks].join('|');
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return toRow(r, rowId(r, n));
});

console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to write) ===');
console.log(`  insert : ${inserts.length}`);
console.log(`  update : ${toUpdate.length}`);
console.log(`  delete : 0 (a sync never deletes)`);
console.log(`  orphans reported, untouched : ${orphans.length}`);
console.log(`  rows flagged for review     : ${inserts.filter((r) => r.needs_review).length}`);
if (unparseable) console.log(`  unparseable timestamps     : ${unparseable}`);

const total = round2(inserts.reduce((a, r) => a + (r.amount ?? 0), 0));
console.log(`  value of new rows          : ${total.toLocaleString('en-IN')}`);

if (!APPLY) {
  console.log('\nNothing was written.');
  process.exit(0);
}

// --- apply ------------------------------------------------------------------
let inserted = 0;
for (let i = 0; i < inserts.length; i += 500) {
  const batch = inserts.slice(i, i + 500);
  // upsert: re-running cannot duplicate even if the diff is re-computed.
  await post('transactions', batch, 'POST', 'return=minimal,resolution=merge-duplicates');
  inserted += batch.length;
  console.log(`  inserted ${inserted}/${inserts.length}`);
}

let updated = 0;
for (const u of toUpdate) {
  const cls = classify({ method: u.after.method, category: u.after.category, remarks: u.after.remarks });
  await post(
    `transactions?id=eq.${encodeURIComponent(u.before.id)}`,
    {
      amount: u.after.amount === null ? null : round2(u.after.amount),
      method: u.after.method,
      category: u.after.category,
      remarks: u.after.remarks,
      kind: cls.kind,
      card_affected: cls.cardAffected,
      card_direction: cls.cardDirection,
      tags: cls.tags,
      // The row changed, so it is no longer the one that was reconciled.
      verified: false,
      updated_by: 'sheet-sync',
    },
    'PATCH',
    'return=minimal',
  );
  updated++;
  console.log(`  updated ${u.before.id}: ${u.changes.join('; ')}`);
}

await post('events', [{
  type: 'sheet.sync',
  detail: JSON.stringify({
    inserted, updated, orphans: orphans.length,
    value: total, at: new Date().toISOString(),
  }),
}], 'POST', 'return=minimal');

console.log(`\nDone. inserted=${inserted} updated=${updated} deleted=0`);
