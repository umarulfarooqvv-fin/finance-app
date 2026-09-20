import 'server-only';
import webpush from 'web-push';
import { readConfigKey, writeConfigKey } from '@/lib/config';
import type { Due } from '@/lib/upcoming';

/* ===========================================================================
   Sending a push to the phone.

   Subscriptions live in app_config rather than a table of their own. This is
   one person with a handful of devices; a migration and a new table to hold
   at most three rows would be machinery for its own sake, and app_config is
   already where per-install configuration lives.

   THE ENDPOINT IS A CAPABILITY. Anyone holding a subscription's endpoint and
   keys can push to that phone, so these never reach the client, never appear
   in a page, and are keyed by a hash rather than by anything guessable.

   A DEAD SUBSCRIPTION IS DELETED, NOT RETRIED. iOS drops a subscription when
   the web app goes unopened for weeks, and the push service answers 404 or
   410 forever after. Keeping it would mean every daily run fails a little,
   which is how a broken notifier looks identical to a quiet one.
   =========================================================================== */

export type PushSubscriptionRecord = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** For the settings screen: which device, roughly, and since when. */
  label: string;
  addedOn: string;
};

export type PushSubscriptions = Record<string, PushSubscriptionRecord>;

const KEY = 'push_subscriptions';

/** A stable id for an endpoint, so re-subscribing replaces rather than doubles. */
export function subscriptionId(endpoint: string): string {
  let h = 5381;
  for (let i = 0; i < endpoint.length; i++) h = ((h * 33) ^ endpoint.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export async function listSubscriptions(): Promise<PushSubscriptions> {
  return (await readConfigKey<PushSubscriptions>(KEY)) ?? {};
}

export async function saveSubscription(rec: PushSubscriptionRecord): Promise<void> {
  const all = await listSubscriptions();
  all[subscriptionId(rec.endpoint)] = rec;
  await writeConfigKey(KEY, all);
}

export async function removeSubscription(id: string): Promise<void> {
  const all = await listSubscriptions();
  delete all[id];
  await writeConfigKey(KEY, all);
}

/** True when the server has what it needs to sign a push. */
export function pushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT,
  );
}

function configure(): void {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

export type PushPayload = { title: string; body: string; tag?: string; url?: string };

export type SendReport = { sent: number; dropped: number; failed: number };

/**
 * Send one payload to every registered device.
 *
 * Failures are counted, never thrown: one dead phone must not stop the others
 * being told, and the daily job reporting a 500 because a device was wiped
 * would hide every real problem behind it.
 */
export async function sendToAll(payload: PushPayload): Promise<SendReport> {
  if (!pushConfigured()) return { sent: 0, dropped: 0, failed: 0 };
  configure();

  const all = await listSubscriptions();
  const report: SendReport = { sent: 0, dropped: 0, failed: 0 };
  const dead: string[] = [];

  await Promise.all(
    Object.entries(all).map(async ([id, sub]) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
          { TTL: 12 * 60 * 60 },
        );
        report.sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          dead.push(id);
          report.dropped += 1;
        } else {
          report.failed += 1;
        }
      }
    }),
  );

  if (dead.length > 0) {
    const fresh = await listSubscriptions();
    for (const id of dead) delete fresh[id];
    await writeConfigKey(KEY, fresh);
  }

  return report;
}

/**
 * One notification for everything due, not one per due.
 *
 * Three separate notifications for three things falling on the same day is
 * three swipes and no more information than one line saying so. The single
 * message leads with the largest, which is the one worth acting on first.
 */
export function composeDigest(dues: Due[], showAmounts = false): PushPayload | null {
  if (dues.length === 0) return null;

  /* A figure here lands on the LOCK SCREEN, which is the one surface this
     app's privacy blur cannot reach and no PIN has guarded. Off unless asked
     for — see ReminderSettings.showAmounts. */
  const money = (n: number | null) =>
    !showAmounts || n == null ? '' : ` \u20b9${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const when = (d: Due) =>
    d.daysAway === 0 ? 'today' : d.daysAway === 1 ? 'tomorrow' : `in ${d.daysAway} days`;

  const [first, ...rest] = [...dues].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

  const title = dues.length === 1 ? `${first!.title} due ${when(first!)}` : `${dues.length} payments coming up`;
  const lines = [`${first!.title}${money(first!.amount)} — ${when(first!)}`];
  for (const d of rest.slice(0, 3)) lines.push(`${d.title}${money(d.amount)} — ${when(d)}`);
  if (rest.length > 3) lines.push(`and ${rest.length - 3} more`);

  return { title, body: lines.join('\n'), tag: 'finance-due', url: '/' };
}
