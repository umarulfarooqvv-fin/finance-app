'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
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
