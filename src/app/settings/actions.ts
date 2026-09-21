'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import { writeConfigKey } from '@/lib/config';
import { ALL_METHODS } from '@/lib/types';
import type { FieldErrors } from '@/lib/action-result';
import { currentSnapshot } from '@/lib/views';
import { saveAccountSettings, saveCardSettings } from '@/lib/settings';
import {
  validateAccountSettings, validateCardSettings,
  type AccountSettingsInput, type CardSettingsInput,
} from '@/lib/validation';

/* ===========================================================================
   Server actions for settings.

   NOTE — a 'use server' module may export ASYNC FUNCTIONS ONLY. Input types
   live in lib/validation and are imported, never re-exported: a surviving
   `export type` throws at module evaluation and 500s every action in the file.

   `/settings` is revalidated alongside the money screens because it displays
   the values it just changed. Without it the form saves and then re-renders
   the old numbers, which reads exactly like the save having failed.
   =========================================================================== */

const REVALIDATE = [...MONEY_PATHS, '/settings'];

async function serverToday(): Promise<string> {
  const { today } = await currentSnapshot();
  return today;
}

export const saveCardSettingsAction = guardedAction(
  {
    name: 'settings.card.save',
    revalidate: REVALIDATE,
    /* Validation cannot be async and the date rules need today, so the cheap
       pass runs against the submitted date and the handler re-checks against
       the server's own clock before writing. A client clock decides nothing. */
    validate: (input: CardSettingsInput) => validateCardSettings(input, '9999-12-31'),
  },
  async (input, ctx) => {
    const errors = validateCardSettings(input, await serverToday());
    if (errors) throw new Error(Object.values(errors)[0] ?? 'Invalid settings.');
    return saveCardSettings(input, ctx);
  },
);

export const saveAccountSettingsAction = guardedAction(
  {
    name: 'settings.account.save',
    revalidate: REVALIDATE,
    validate: (input: AccountSettingsInput) => validateAccountSettings(input, '9999-12-31'),
  },
  async (input, ctx) => {
    const errors = validateAccountSettings(input, await serverToday());
    if (errors) throw new Error(Object.values(errors)[0] ?? 'Invalid settings.');
    return saveAccountSettings(input, ctx);
  },
);

/* ===========================================================================
   The bank-label mapping.

   A UPI history names an account the way the bank does — "Federal 2788" —
   and this ledger names it Fi. Nothing in either string hints at the other,
   so the importer needs to be told once.

   Stored whole rather than merged key by key: removing a line is as much an
   edit as adding one, and a merge could never express a deletion.
   =========================================================================== */

export const saveBankMethodsAction = guardedAction(
  {
    name: 'settings.bank-methods.save',
    revalidate: REVALIDATE,
    validate: (input: { mapping: Record<string, string> }): FieldErrors | null => {
      if (!input.mapping || typeof input.mapping !== 'object') {
        return { mapping: 'Nothing to save.' };
      }
      for (const [label, method] of Object.entries(input.mapping)) {
        if (!label.trim()) return { mapping: 'A bank label cannot be blank.' };
        if (!(ALL_METHODS as readonly string[]).includes(method)) {
          return { mapping: `"${method}" is not a payment method this app knows.` };
        }
      }
      return null;
    },
  },
  async (input) => {
    const clean: Record<string, string> = {};
    for (const [label, method] of Object.entries(input.mapping)) clean[label.trim()] = method;
    await writeConfigKey('bank_methods', clean);
    return clean;
  },
);
