import { classify } from './classify.ts';
import { nowIST, type Instant } from './time.ts';
import type { Transaction } from './types.ts';

/* ===========================================================================
   Normalising a new entry (from the iPhone Shortcut, or the in-app form).

   Kept in `domain/` rather than in the route so it can be tested without a
   server, and so the Shortcut path and the app form cannot drift apart.
   =========================================================================== */

export type EntryInput = {
  amount: string | number | null | undefined;
  method: string | null | undefined;
  category: string | null | undefined;
  remarks?: string | null | undefined;
  /** Overrides the server clock; used by the importer. */
  ts?: Instant | null;
};

export type NormalisedEntry = Omit<Transaction, 'verified' | 'deleted'> & {
  verified: false;
  deleted: false;
};

/** Amounts arrive as "1,234.50", "₹1234", or a number. */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const cleaned = raw.replace(/[₹,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Deterministic id from the row's own content, so a retried Shortcut post
    upserts instead of creating a duplicate entry. */
async function entryId(parts: (string | number | null)[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join('|'));
  const digest = await crypto.subtle.digest('SHA-1', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `tx-${hex.slice(0, 16)}`;
}

export async function normaliseEntry(input: EntryInput, source = 'shortcut'): Promise<NormalisedEntry> {
  const amount = parseAmount(input.amount);
  const method = (input.method ?? '').trim();
  const category = (input.category ?? '').trim();
  const remarks = (input.remarks ?? '').trim();
  const ts = input.ts ?? nowIST();

  const cls = classify({ method, category, remarks });

  return {
    id: await entryId([ts, amount, method, category, remarks]),
    ts,
    amount,
    method,
    category,
    remarks,
    kind: cls.kind,
    cardAffected: cls.cardAffected,
    cardDirection: cls.cardDirection,
    tags: cls.tags,
    // A new entry is never pre-verified — verification means "I matched this
    // against the bank statement", which cannot be true the moment it is made.
    verified: false,
    needsReview: amount === null || cls.kind === 'unknown',
    deleted: false,
    source,
  };
}

/** Map the domain shape onto the Postgres column names. */
export function toRow(e: NormalisedEntry): Record<string, unknown> {
  return {
    id: e.id,
    ts: e.ts,
    amount: e.amount,
    method: e.method,
    category: e.category,
    remarks: e.remarks,
    kind: e.kind,
    card_affected: e.cardAffected,
    card_direction: e.cardDirection,
    tags: e.tags,
    verified: e.verified,
    needs_review: e.needsReview,
    deleted: e.deleted,
    source: e.source,
  };
}
