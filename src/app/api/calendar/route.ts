import { timingSafeEqual } from 'node:crypto';
import { getSnapshot } from '@/lib/snapshot';
import { buildIcs } from '@/lib/ics';
import { upcomingDues } from '@/lib/upcoming';
import { dayOf, nowIST } from '@/lib/time';
import { readConfigKey } from '@/lib/config';
import { DEFAULT_REMINDERS, type ReminderSettings } from '@/lib/reminders';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   The reminder calendar, as a feed a phone subscribes to.

   NOT SESSION-GUARDED, and it cannot be: iOS fetches this on its own schedule
   with no cookie jar and no way to log in. The URL carries a secret instead,
   which makes the URL itself the credential — so it is never rendered into a
   page, never logged, and regenerating the secret revokes every device at
   once.

   The reply names no amounts a stranger could act on beyond the dues
   themselves, but it is still the user's financial calendar, so an absent
   token is a refusal rather than a public feed. That is the opposite of the
   Shortcut endpoint's rule, where an unset token means "open"; there the
   danger is a write being blocked, here it is a life being read.
   =========================================================================== */

const HORIZON_DAYS = 120;

function tokenOk(presented: string | null): boolean {
  const expected = process.env.CALENDAR_TOKEN;
  // No token configured = the feed is off, not open to everyone.
  if (!expected || expected.length < 16) return false;
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // Compared in constant time: a plain !== leaks the secret a byte at a time
  // to anyone who can measure the reply.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!tokenOk(url.searchParams.get('token'))) {
    return new Response('Not found', { status: 404 });
  }

  const snap = await getSnapshot();
  const today = dayOf(nowIST());
  const settings = (await readConfigKey<ReminderSettings>('reminders')) ?? DEFAULT_REMINDERS;

  const ics = buildIcs(upcomingDues(snap, today, HORIZON_DAYS), {
    leadDays: settings.leadDays,
    showAmounts: settings.showAmounts,
    generatedAt: nowIST(),
    domain: url.hostname,
  });

  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'no-store',
      // A secret in the URL must not end up in a referrer header or a proxy's
      // index of what it has seen.
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
      'content-disposition': 'inline; filename="finance-reminders.ics"',
    },
  });
}
