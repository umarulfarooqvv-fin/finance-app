import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transactionsFromCsv } from '../src/domain/csv.ts';
import { DEFAULT_ACCOUNTS, DEFAULT_CARDS } from '../src/domain/defaults.ts';
import type { Income, Snapshot, Transaction } from '../src/domain/types.ts';

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

/** Build a transaction without repeating every field at each call site. */
export function tx(over: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    ts: '2026-06-01T10:00:00',
    amount: 100,
    method: 'Fi',
    category: 'Food',
    remarks: '',
    kind: 'spend',
    cardAffected: null,
    cardDirection: null,
    tags: {},
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
