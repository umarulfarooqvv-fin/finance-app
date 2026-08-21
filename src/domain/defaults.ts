import type { Account, Card } from './types.ts';

/* ===========================================================================
   Seed configuration, audited against the workbook's Card_Settings tab.

   These are starting values only. Anything the user edits is persisted to
   app_config and wins over what is here — this file must never overwrite a
   card that has already been configured by hand.

   `openingBalance` is the debt each card carried on `openingDate`, the day
   tracking began. The engine skips rows older than that date and adds the
   opening balance instead, so pre-tracking history is not counted twice.
   =========================================================================== */

export const DEFAULT_CARDS: Card[] = [
  {
    name: 'Edge',
    billDate: 6,
    graceDays: 15,
    dueDay: 21,
    dueCycle: 'same',
    creditLimit: 50000,
    openingBalance: 6851.68,
    openingDate: '2025-12-10',
    slot: 1,
    active: true,
  },
  {
    name: 'One Card',
    billDate: 22,
    graceDays: 16,
    dueDay: 8,
    dueCycle: 'next',
    creditLimit: 115000,
    openingBalance: 858.57,
    openingDate: '2025-12-10',
    slot: 2,
    active: true,
  },
  {
    name: 'ICICI',
    billDate: 5,
    graceDays: 18,
    dueDay: 23,
    dueCycle: 'same',
    creditLimit: 50000,
    openingBalance: 5433.13,
    openingDate: '2025-12-10',
    slot: 3,
    active: true,
  },
  {
    name: 'Coral',
    billDate: 25,
    graceDays: 17,
    dueDay: 12,
    dueCycle: 'next',
    creditLimit: 50000,
    openingBalance: 2662.72,
    openingDate: '2025-12-15',
    slot: 4,
    active: true,
  },
  {
    name: 'Scapia',
    billDate: 14,
    graceDays: 19,
    dueDay: 3,
    dueCycle: 'next',
    creditLimit: 48000,
    openingBalance: 16951.5,
    openingDate: '2026-01-04',
    slot: 5,
    active: true,
  },
  {
    name: 'Super Money',
    billDate: 1,
    graceDays: 14,
    dueDay: 15,
    dueCycle: 'same',
    creditLimit: 2452.5,
    openingBalance: 0,
    openingDate: '2025-12-10',
    slot: 6,
    active: true,
  },
];

export const DEFAULT_ACCOUNTS: Account[] = [
  { name: 'Fi', kind: 'bank', openingBalance: 0, since: null, active: true },
  { name: 'Jupiter', kind: 'bank', openingBalance: 0, since: null, active: true },
  { name: 'SBI', kind: 'bank', openingBalance: 0, since: null, active: true },
  { name: 'Cash', kind: 'cash', openingBalance: 0, since: null, active: true },
];

/** Bill is flagged as due-soon at or under this many days. Spec §3.2. */
export const DUE_SOON_DAYS = 5;
