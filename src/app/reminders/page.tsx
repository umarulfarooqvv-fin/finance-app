import { getSnapshot } from '@/lib/snapshot';
import { dayOf } from '@/lib/time';
import { detectRecurring, subscriptionsFrom } from '@/lib/recurring-detect';
import { remindersFrom } from '@/lib/reminders';
import { upcomingDues } from '@/lib/upcoming';
import { pushConfigured } from '@/lib/push';
import { Page, PageHeader } from '@/components/layout/page-header';
import { RemindersClient } from './reminders-client';

export const dynamic = 'force-dynamic';

const HORIZON_DAYS = 60;

/* ===========================================================================
   Reminders.

   The server does the deciding — what is due, what looks recurring, what has
   been confirmed — and hands the client a finished list. The VAPID PUBLIC key
   is passed through because the browser needs it to subscribe; the private one
   never leaves the server, and neither does any stored subscription.
   =========================================================================== */

export default async function RemindersPage() {
  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);

  const confirmed = subscriptionsFrom(snap.config);
  const settings = remindersFrom(snap.config);

  /* Candidates minus the ones already confirmed: a list that keeps offering
     what you have already said yes to reads as though the yes did not take. */
  const candidates = detectRecurring(snap, today).filter((c) => !confirmed[c.key]);

  return (
    <Page>
      <PageHeader
        title="Reminders"
        subtitle="Bills, instalments and subscriptions — before they are late"
      />
      <RemindersClient
        dues={upcomingDues(snap, today, HORIZON_DAYS)}
        candidates={candidates}
        confirmed={confirmed}
        settings={settings}
        today={today}
        vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null}
        pushReady={pushConfigured()}
        calendarReady={Boolean(process.env.CALENDAR_TOKEN)}
      />
    </Page>
  );
}
