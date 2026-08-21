import { classify, parseTimestamp } from './classify.ts';
import type { Transaction } from './types.ts';

/* ===========================================================================
   CSV reading, for importing sheet history and for loading test fixtures.
   The live app does not use this — Postgres is the source of truth — but the
   fixture is a real snapshot of the sheet, so the engine's tests run against
   genuine data rather than invented rows.
   =========================================================================== */

const QUOTE = '"';
const COMMA = ',';
const NEWLINE = '\n';
const RETURN = '\r';

/** RFC4180-ish: handles quoted fields containing commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === QUOTE) {
        if (text[i + 1] === QUOTE) {
          field += QUOTE;
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === QUOTE) inQuotes = true;
    else if (c === COMMA) {
      row.push(field);
      field = '';
    } else if (c === NEWLINE) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== RETURN) field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Stable id for an imported row, so re-importing upserts instead of duplicating. */
async function rowId(parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join(' '));
  const digest = await crypto.subtle.digest('SHA-1', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/**
 * Columns: Timestamp | Amount | Payment Method | Category | Remarks.
 * Row 0 is the header. Blank rows are skipped; rows that fail to parse are
 * kept and flagged `needsReview` rather than dropped — silently losing a row
 * loses money.
 */
export async function transactionsFromCsv(text: string): Promise<Transaction[]> {
  const rows = parseCsv(text);
  const out: Transaction[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const [tsRaw = '', amtRaw = '', method = '', category = '', remarks = ''] = r;
    if (![tsRaw, amtRaw, method, category, remarks].some((c) => c.trim())) continue;

    const parsed = parseTimestamp(tsRaw);
    const amount = amtRaw.trim() === '' ? null : Number(amtRaw.replace(/,/g, ''));
    const cls = classify({
      method: method.trim(),
      category: category.trim(),
      remarks: remarks.trim(),
    });

    out.push({
      id: 'tx-' + (await rowId([String(i + 1), tsRaw, amtRaw, method, category, remarks])),
      ts: parsed?.ts ?? null,
      amount: Number.isFinite(amount) ? amount : null,
      method: method.trim(),
      category: category.trim(),
      remarks: remarks.trim(),
      kind: cls.kind,
      cardAffected: cls.cardAffected,
      cardDirection: cls.cardDirection,
      tags: cls.tags,
      verified: false,
      needsReview: !parsed || amount === null || !Number.isFinite(amount) || cls.kind === 'unknown',
      deleted: false,
      source: 'import',
    });
  }
  return out;
}
