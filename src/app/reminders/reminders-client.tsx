'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, CalendarClock, Check, CreditCard, Repeat, X } from 'lucide-react';
import type { Due } from '@/lib/upcoming';
import type { ConfirmedSubscription, RecurringCandidate, Subscriptions } from '@/lib/recurring-detect';
import type { ReminderSettings } from '@/lib/reminders';
import { formatDayShort } from '@/lib/time';
import { Badge, Empty, Money, Panel, SectionTitle, cx } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Copyable } from '@/components/shortcut-recipe';
import {
  confirmSubscriptionAction, forgetSubscriptionAction, saveReminderSettingsAction,
} from './actions';

/* ===========================================================================
   Turning the app's own knowledge of the future into an alert.

   Three sections, in the order the questions actually arise: what is coming,
   what should count as a standing commitment, and how to be told.
   =========================================================================== */

const LEAD_CHOICES = [7, 3, 1, 0];

const KIND: Record<Due['kind'], { label: string; icon: typeof CreditCard }> = {
  bill: { label: 'Card bill', icon: CreditCard },
  emi: { label: 'EMI', icon: CalendarClock },
  subscription: { label: 'Subscription', icon: Repeat },
};

export function RemindersClient({
  dues, candidates, confirmed, settings, today, vapidPublicKey, pushReady, calendarReady,
}: {
  dues: Due[];
  candidates: RecurringCandidate[];
  confirmed: Subscriptions;
  settings: ReminderSettings;
  today: string;
  vapidPublicKey: string | null;
  pushReady: boolean;
  calendarReady: boolean;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [leads, setLeads] = useState<number[]>(settings.leadDays);

  const confirmedList = Object.entries(confirmed);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) { notify('error', r.error ?? 'That did not save.'); return; }
      notify('success', done);
      router.refresh();
    });

  const toggleLead = (n: number) => {
    const next = leads.includes(n) ? leads.filter((x) => x !== n) : [...leads, n];
    if (next.length === 0) { notify('error', 'Keep at least one warning, or nothing will be sent.'); return; }
    setLeads(next);
    run(() => saveReminderSettingsAction({ ...settings, leadDays: next }), 'Saved.');
  };

  return (
    <>
      {/* ---- What is coming ------------------------------------------- */}
      <Panel className="mb-4">
        <SectionTitle>Coming up &middot; {dues.length}</SectionTitle>
        {dues.length === 0 ? (
          <Empty title="Nothing due in the next two months" hint="Bills with nothing owing are left out." />
        ) : (
          <ul className="flex flex-col">
            {dues.map((d) => {
              const k = KIND[d.kind];
              const Icon = k.icon;
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <Badge tone="neutral">{k.label}</Badge>
                  <span className="num w-24 shrink-0 text-right text-xs text-[var(--color-ink-3)]">
                    {formatDayShort(d.on)}
                  </span>
                  <span
                    className={cx(
                      'num w-20 shrink-0 text-right text-xs',
                      d.daysAway <= 3 ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink-3)]',
                    )}
                  >
                    {d.daysAway === 0 ? 'today' : d.daysAway === 1 ? 'tomorrow' : `${d.daysAway} days`}
                  </span>
                  {d.amount == null ? <span className="w-20" /> : <Money value={d.amount} size="sm" tone="debt" />}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* ---- What should count as recurring ---------------------------- */}
      {candidates.length > 0 ? (
        <Panel className="mb-4">
          <SectionTitle>Looks recurring &middot; {candidates.length}</SectionTitle>
          <p className="mb-2 text-xs text-[var(--color-ink-2)]">
            Charges that have come back at least three times, at roughly the same interval for
            roughly the same amount. Nothing here is reminded about until you say so &mdash; a
            guessed subscription that quietly buzzes every month is how you learn to ignore this.
          </p>
          <ul className="flex flex-col">
            {candidates.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <Badge tone="neutral">{c.category}</Badge>
                <span className="shrink-0 text-[11px] text-[var(--color-ink-3)]">
                  every ~{c.everyDays}d &middot; seen {c.seen} &middot; last {formatDayShort(c.lastOn)}
                </span>
                <Money value={c.amount} size="sm" tone="debt" />
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => confirmSubscriptionAction({
                        key: c.key,
                        sub: {
                          name: c.name, amount: c.amount, everyDays: c.everyDays,
                          method: c.method, category: c.category, lastOn: c.lastOn,
                        },
                      }),
                      `${c.name} will be reminded about.`,
                    )
                  }
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Track
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {confirmedList.length > 0 ? (
        <Panel className="mb-4">
          <SectionTitle>Tracked subscriptions &middot; {confirmedList.length}</SectionTitle>
          <ul className="flex flex-col">
            {confirmedList.map(([key, s]: [string, ConfirmedSubscription]) => (
              <li key={key} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0">
                <Repeat className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="shrink-0 text-[11px] text-[var(--color-ink-3)]">
                  every ~{s.everyDays}d on {s.method}
                </span>
                <Money value={s.amount} size="sm" tone="debt" />
                <Button
                  size="sm" variant="ghost" disabled={pending}
                  aria-label={`Stop reminding about ${s.name}`}
                  onClick={() => run(() => forgetSubscriptionAction({ key }), `${s.name} removed.`)}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* ---- How to be told -------------------------------------------- */}
      <Panel className="mb-4">
        <SectionTitle>When to warn you</SectionTitle>
        <p className="mb-2 text-xs text-[var(--color-ink-2)]">
          A warning is sent on each day you pick and no others, so a bill due on the 23rd is two
          messages rather than four days of the same sentence.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {LEAD_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              disabled={pending}
              onClick={() => toggleLead(n)}
              className={cx(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                leads.includes(n)
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)]',
              )}
            >
              {n === 0 ? 'On the day' : `${n} day${n === 1 ? '' : 's'} before`}
            </button>
          ))}
        </div>

        {/* The lock screen is the one surface this app's privacy blur cannot
            reach, so naming a figure there is a decision rather than a
            default. */}
        <label className="mt-3 flex items-start gap-2 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-ink-2)]">
          <input
            type="checkbox"
            checked={settings.showAmounts}
            disabled={pending}
            onChange={(e) =>
              run(
                () => saveReminderSettingsAction({ ...settings, leadDays: leads, showAmounts: e.target.checked }),
                'Saved.',
              )
            }
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            Show the amount in the alert.
            <span className="text-[var(--color-ink-3)]">
              {' '}Off by default: a notification appears on the lock screen, where privacy mode
              cannot blur it and no PIN has been entered. Left off, an alert says what is due and
              when, but not how much.
            </span>
          </span>
        </label>
      </Panel>

      <PushPanel vapidPublicKey={vapidPublicKey} pushReady={pushReady} />

      <CalendarPanel ready={calendarReady} today={today} />
    </>
  );
}

/* --- Push ---------------------------------------------------------------- */

type PushState = 'unsupported' | 'not-home-screen' | 'denied' | 'off' | 'on';

function PushPanel({ vapidPublicKey, pushReady }: { vapidPublicKey: string | null; pushReady: boolean }) {
  const { notify } = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!supported) { if (live) setState('unsupported'); return; }

      /* iOS only exposes push to a web app launched from the Home Screen. In
         Safari proper the APIs exist and permission requests silently fail, so
         detecting the tab is the difference between a useful instruction and a
         button that does nothing. */
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as { standalone?: boolean }).standalone === true;
      const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (iOS && !standalone) { if (live) setState('not-home-screen'); return; }

      if (Notification.permission === 'denied') { if (live) setState('denied'); return; }

      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (live) setState(sub ? 'on' : 'off');
    })();
    return () => { live = false; };
  }, []);

  async function enable() {
    if (!vapidPublicKey) { notify('error', 'Push is not configured on the server yet.'); return; }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setState(permission === 'denied' ? 'denied' : 'off'); return; }

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, label: deviceLabel() }),
      });
      if (!res.ok) throw new Error('The server would not accept this device.');

      setState('on');
      notify('success', 'This device will be reminded.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not turn on notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState('off');
      notify('success', 'This device will not be reminded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="mb-4">
      <SectionTitle>Notifications on this device</SectionTitle>

      {!pushReady ? (
        <p className="text-xs text-[var(--color-ink-2)]">
          Push is not set up on the server yet. It needs a VAPID key pair in{' '}
          <code>VAPID_PUBLIC_KEY</code>, <code>VAPID_PRIVATE_KEY</code> and <code>VAPID_SUBJECT</code>.
          The calendar below works without any of that.
        </p>
      ) : state === null ? (
        <p className="text-xs text-[var(--color-ink-3)]">Checking&hellip;</p>
      ) : state === 'unsupported' ? (
        <p className="text-xs text-[var(--color-ink-2)]">
          This browser cannot receive push notifications. Use the calendar below instead.
        </p>
      ) : state === 'not-home-screen' ? (
        <p className="text-xs text-[var(--color-ink-2)]">
          On an iPhone, notifications only work once this app is added to the Home Screen. Tap
          Share, then <strong>Add to Home Screen</strong>, open it from there, and come back to this
          page. Until then the calendar below is the way to be reminded.
        </p>
      ) : state === 'denied' ? (
        <p className="text-xs text-[var(--color-ink-2)]">
          Notifications are blocked for this app. Turn them back on in iOS Settings &rarr;
          Notifications &rarr; Finance, then return here.
        </p>
      ) : state === 'on' ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-pos)]">
            <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
            This device is registered.
          </span>
          <Button size="sm" variant="secondary" pending={busy} onClick={disable}>Turn off</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-[var(--color-ink-2)]">
            One notification a day at most, and only when something is actually due.
          </span>
          <Button size="sm" pending={busy} onClick={enable}>Turn on</Button>
        </div>
      )}
    </Panel>
  );
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  return 'This device';
}

/** The VAPID key travels as base64url and the API wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  // Backed by a plain ArrayBuffer explicitly: a Uint8Array may sit on a
  // SharedArrayBuffer, which subscribe() will not take.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/* --- Calendar ------------------------------------------------------------ */

function CalendarPanel({ ready, today }: { ready: boolean; today: string }) {
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <Panel>
      <SectionTitle>Calendar, as a backstop</SectionTitle>
      {!ready ? (
        <p className="text-xs text-[var(--color-ink-2)]">
          Set <code>CALENDAR_TOKEN</code> on the server to at least 16 characters and a private
          calendar feed appears here. It needs no permission and no install, and it keeps working
          when a push subscription lapses.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-[var(--color-ink-2)]">
            Subscribe once on the phone and every due date appears in Calendar with its own alert.
            It survives what push does not &mdash; no permission to grant, nothing to re-enable.
            <strong className="text-[var(--color-ink-2)]"> Treat this address as a password:</strong>{' '}
            anyone who has it can read what you owe and when.
          </p>
          <ol className="mb-3 flex flex-col gap-1 text-[11px] text-[var(--color-ink-3)]">
            <li>1. iOS Settings &rarr; Apps &rarr; Calendar &rarr; Accounts &rarr; Add Account &rarr; Other</li>
            <li>2. Add Subscribed Calendar, and paste the address below</li>
            <li>3. Set alerts to on. Last refreshed {formatDayShort(today)}.</li>
          </ol>
          {/* Rendered only once the origin is known client-side, so the server
              never bakes a secret URL into HTML that could be cached. */}
          {origin ? (
            <Copyable label="Calendar address" value={`${origin}/api/calendar?token=YOUR_CALENDAR_TOKEN`} />
          ) : null}
          <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
            Replace <code>YOUR_CALENDAR_TOKEN</code> with the value you set on the server. It is not
            printed here on purpose &mdash; a secret rendered into a page ends up in screenshots and
            caches.
          </p>
        </>
      )}
    </Panel>
  );
}
