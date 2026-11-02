import { parseImport } from '@/lib/import-parse';
import { dateFromReading } from '@/lib/capture-entry';
import type { BankMethods } from '@/lib/bank-methods';
import type { Place } from '@/lib/place';
import type { Instant } from '@/lib/time';
import type { Transaction } from '@/lib/types';

/* ===========================================================================
   Photos the AI has read, offered on Entries as DRAFT entries.

   Nothing here writes. A draft is shown where the entry would sit, looking
   unfinished on purpose, and becomes an entry only when a person presses Add
   (or edits it and saves) — the same read-and-confirm every other path from a
   photo demands, just one tap closer to where entries are looked at.

   Only money spent. A row read as money received belongs on Income and is
   left to the inbox's Review, which can file it there.

   Pure: the readings, the photos and the ledger in, drafts out.
   =========================================================================== */

export type DraftEntry = {
  /** `${captureId}\u0000${raw}` — stable while the reading is unchanged. */
  key: string;
  captureId: string;
  /** The row's own text in the reading; how it is found again. */
  raw: string;
  ts: Instant;
  amount: number | null;
  method: string;
  category: string;
  remarks: string;
  tags: string[];
  /** Amount, payment and category are all known: Add can save it as it is. */
  complete: boolean;
  /** One line about the date, when it needed a judgement. */
  dateNote: string | null;
  /** An entry already on file that looks like this one. */
  duplicateOf: { remarks: string; method: string; amount: number } | null;
  /** The photo's size, for the form's photo field. */
  bytes: number;
  /** Where the phone was when the photo was taken, if the Shortcut sent it. */
  place: Place | null;
};

export type Reading = { text?: string; hidden?: string[] };

export function draftEntries(
  captures: { id: string; ts: string; bytes: number }[],
  readings: Record<string, Reading>,
  bankMethods: BankMethods,
  transactions: Transaction[],
  places: Record<string, Place> = {},
): DraftEntry[] {
  // Live entries by day, for the "already recorded?" check.
  const byDay = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.deleted || !t.ts || t.amount == null) continue;
    const d = t.ts.slice(0, 10);
    const list = byDay.get(d);
    if (list) list.push(t); else byDay.set(d, [t]);
  }

  const out: DraftEntry[] = [];
  for (const c of captures) {
    const r = readings[c.id];
    if (!r?.text) continue;
    const hidden = new Set(r.hidden ?? []);
    const { rows } = parseImport(r.text, { bankMethods });
    for (const row of rows) {
      if (row.direction !== 'out' || hidden.has(row.raw)) continue;
      const dated = dateFromReading(row.day, row.time, c.ts as Instant);
      const day = dated.ts.slice(0, 10);
      const amount = row.amount > 0 ? row.amount : null;
      const twin = amount == null ? undefined : (byDay.get(day) ?? []).find((t) => Math.abs(t.amount! - amount) < 0.005);
      out.push({
        key: `${c.id}\u0000${row.raw}`,
        captureId: c.id,
        raw: row.raw,
        ts: dated.ts,
        amount,
        method: row.method,
        category: row.category,
        remarks: row.remarks,
        tags: row.tags,
        complete: amount != null && Boolean(row.method) && Boolean(row.category),
        dateNote: dated.yearCorrected
          ? 'Year read off the photo did not fit — taken as the photo’s year'
          : dated.dateDoubtful
            ? 'Date on the photo looked wrong — dated when the photo was taken'
            : null,
        duplicateOf: twin ? { remarks: twin.remarks || twin.category, method: twin.method, amount: twin.amount! } : null,
        bytes: c.bytes,
        place: places[c.id] ?? null,
      });
    }
  }
  return out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}
