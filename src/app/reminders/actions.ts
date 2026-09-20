'use server';

import { guardedAction, MONEY_PATHS } from '@/lib/actions';
import type { FieldErrors } from '@/lib/action-result';
import { updateConfigKey, writeConfigKey } from '@/lib/config';
import { remindersFrom, type ReminderSettings } from '@/lib/reminders';
import type { ConfirmedSubscription, Subscriptions } from '@/lib/recurring-detect';
import { currentSnapshot } from '@/lib/views';

/* ===========================================================================
   Server actions for reminders.

   Nothing here touches a transaction. Confirming a subscription records what
   to WATCH for; it never creates the charge, and a reminder that quietly
   wrote an entry would put money in the ledger that nobody spent.
   =========================================================================== */

const REVALIDATE = [...MONEY_PATHS, '/reminders'];

export const confirmSubscriptionAction = guardedAction(
  {
    name: 'reminders.subscription.confirm',
    revalidate: REVALIDATE,
    validate: (input: { key: string; sub: ConfirmedSubscription }): FieldErrors | null => {
      if (!input.key?.trim()) return { key: 'Which subscription?' };
      if (!input.sub?.name?.trim()) return { name: 'A subscription needs a name.' };
      if (!(input.sub.amount > 0)) return { amount: 'Enter what it costs.' };
      if (!Number.isInteger(input.sub.everyDays) || input.sub.everyDays < 1 || input.sub.everyDays > 366) {
        return { everyDays: 'How many days between charges?' };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sub.lastOn)) return { lastOn: 'That is not a date.' };
      return null;
    },
  },
  async (input) => {
    await updateConfigKey<Subscriptions>('subscriptions', (current) => ({
      ...current,
      [input.key]: input.sub,
    }));
    return { key: input.key };
  },
);

export const forgetSubscriptionAction = guardedAction(
  {
    name: 'reminders.subscription.forget',
    revalidate: REVALIDATE,
    validate: (input: { key: string }): FieldErrors | null =>
      input.key?.trim() ? null : { key: 'Which subscription?' },
  },
  async (input) => {
    await updateConfigKey<Subscriptions>('subscriptions', (current) => {
      const next = { ...current };
      delete next[input.key];
      return next;
    });
    return { key: input.key };
  },
);

export const saveReminderSettingsAction = guardedAction(
  {
    name: 'reminders.settings.save',
    revalidate: REVALIDATE,
    validate: (input: ReminderSettings): FieldErrors | null => {
      if (!Array.isArray(input.leadDays) || input.leadDays.length === 0) {
        return { leadDays: 'Choose at least one time to be warned.' };
      }
      if (input.leadDays.some((n) => !Number.isInteger(n) || n < 0 || n > 365)) {
        return { leadDays: 'A warning is between 0 and 365 days ahead.' };
      }
      return null;
    },
  },
  async (input) => {
    // Normalised on the way in, so every reader gets the same shape whatever
    // the form sent.
    const clean = remindersFrom({ reminders: input });
    await writeConfigKey('reminders', clean);
    return clean;
  },
);

/** Today, from the server's own clock — a device clock decides no schedule. */
export async function serverToday(): Promise<string> {
  const { today } = await currentSnapshot();
  return today;
}
