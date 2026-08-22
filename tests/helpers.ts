import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classify } from '@/lib/classify';
import { transactionsFromCsv } from '@/lib/csv';
import { DEFAULT_ACCOUNTS, DEFAULT_CARDS } from '@/lib/defaults';
import type { Income, Snapshot, Transaction } from '@/lib/types';

/** The fixture is a real snapshot of the Daily Spent sheet (10-Jun-2026). */
export function fixtureCsv(): string {
  return readFileSync(fileURLToPath(new URL('./fixture.csv', import.meta.url)), 'utf8');
}

export async function fixtureTransactions(): Promise<Transaction[]> {
  return transactionsFromCsv(fixtureCsv());
}

export function makeSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    transactions: [],
    income: [],
    cards: DEFAULT_CARDS,
    accounts: DEFAULT_ACCOUNTS,
    config: {},
    version: 1,
    loadedAt: '2026-06-10T12:00:00',
    ...over,
  };
}

let seq = 0;

/**
 * Build a transaction without repeating every field at each call site.
 *
 * Derived fields — kind, card, direction, tags — are computed from
 * method/category/remarks exactly as `toTransaction` does when loading from
 * Postgres, so a fixture behaves like a real row. Building them by hand made
 * the helper LESS faithful than production: a row with "Ipad Mini 1/24" in its
 * remarks arrived with empty tags, and the EMI grouper correctly found nothing
 * to group.
 *
 * Explicit overrides still win, so a test can construct an incoherent row on
 * purpose to prove the engine copes with one.
 */
export function tx(over: Partial<Transaction> = {}): Transaction {
  seq += 1;
  const method = over.method ?? 'Fi';
  const category = over.category ?? 'Food';
  const remarks = over.remarks ?? '';
  const derived = classify({ method, category, remarks });

  return {
    id: `t${seq}`,
    ts: '2026-06-01T10:00:00',
    amount: 100,
    method,
    category,
    remarks,
    kind: derived.kind,
    cardAffected: derived.cardAffected,
    cardDirection: derived.cardDirection,
    tags: derived.tags,
    verified: false,
    needsReview: false,
    deleted: false,
    source: 'test',
    ...over,
  };
}

export function income(over: Partial<Income> = {}): Income {
  seq += 1;
  return {
    id: `i${seq}`,
    ts: '2026-06-01T10:00:00',
    amount: 1000,
    source: 'Salary',
    account: 'Fi',
    remarks: '',
    needsReview: false,
    deleted: false,
    ...over,
  };
}
