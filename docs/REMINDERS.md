# Reminders

Bills, EMI instalments and subscriptions, before they are late.

> `docs/DEPLOY.md` is **v2** and its section 4 describes an ntfy alert at
> `/api/alerts`. Neither exists in v3 — `NTFY_TOPIC` does nothing now. This
> document replaces it. (The v2 docs are read-only on purpose and were left
> alone.)

## What it knows about

| Source | Where it comes from |
|---|---|
| Card bills | `cardStatement()` — only when something is actually owing |
| EMI instalments | `emiPlans()`, from the `n/m` counter in a remark |
| Subscriptions | `app_config.subscriptions` — **only what you have confirmed** |

`src/lib/upcoming.ts` merges the three into one date-ordered list. It is pure:
`today` is a parameter, so it can be asked what next Tuesday looks like.

Detection (`src/lib/recurring-detect.ts`) proposes subscriptions on the
`/reminders` page — a charge seen three or more times at 20–45 day spacing for
a steady amount. It judges the **current run**, not all history, so one lapse
years ago does not disqualify something that has been monthly since. Nothing
proposed is ever reminded about until you tick it: a guessed subscription that
buzzes every month is how you learn to ignore the app.

## Setup

```bash
npm run gen:vapid -- --write --subject mailto:you@example.com
```

Writes five values to `.env.local` without printing them, and refuses if any
are already set. Copy the same five into **Vercel → Settings → Environment
Variables** (the form takes a whole `.env` block pasted at once) and redeploy.

| Variable | What it does |
|---|---|
| `VAPID_PUBLIC_KEY` | Handed to the browser to subscribe with |
| `VAPID_PRIVATE_KEY` | Signs each push. Never leaves the server |
| `VAPID_SUBJECT` | A real `mailto:`/`https:` contact. Push services reject a fake one |
| `CRON_SECRET` | Guards `/api/cron/reminders`. **Unset = it refuses everyone** |
| `CALENDAR_TOKEN` | The feed's secret. Unset = the feed is off, not public |

Regenerating the VAPID pair unsubscribes every device — which is also how you
revoke a phone you no longer have.

## The daily run

`vercel.json` schedules `/api/cron/reminders` at `30 2 * * *` UTC = 08:00 IST.
**Vercel reads that at deploy time**, so the schedule does not exist until you
deploy.

It sends nothing most days. A warning fires only on a configured lead day, so a
bill due on the 23rd is one message on the 20th and one on the 23rd — not four
days of the same sentence. Silence is the normal outcome and is a success.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP.vercel.app/api/cron/reminders
```

`{"ok":true,"due":N,"sent":N}`. A `404` means the secret did not match.

## Push, on an iPhone

Apple delivers push only to a web app **added to the Home Screen** — never to a
Safari tab. Open the deployed site in Safari → Share → *Add to Home Screen* →
launch it from there → `/reminders` → **Turn on**. In a plain tab the page says
so rather than showing a button that does nothing.

iOS drops the subscription when the app goes unopened for weeks. That is not a
bug anyone can fix, and it is the whole reason the calendar exists.

## Calendar, the backstop

No install, no permission, and it keeps working when a push subscription
lapses. On the phone: Settings → Apps → Calendar → Accounts → Add Account →
Other → **Add Subscribed Calendar**:

```
https://YOUR-APP.vercel.app/api/calendar?token=YOUR_CALENDAR_TOKEN
```

**That address is a credential, and it travels in the query string** — a
calendar subscription cannot send headers, which is the very thing
`/api/entry` avoids by taking its token in one. So it *will* appear in request
logs. Rotate `CALENDAR_TOKEN` if a log is ever shared; rotating revokes every
subscribed device at once.

## Amounts are left out by default

A notification and a calendar alert land on the **lock screen**, where privacy
mode cannot blur them and no PIN has been entered. Left off, an alert says what
is due and when, not how much. There is a checkbox on `/reminders`, because the
figure is genuinely useful and the risk is the owner's to take.

## Local testing

The dev server must be restarted after `.env.local` changes. If a route 404s
with a correct secret, suspect a stale build cache before suspecting the
secret — `rm -rf .next` and restart. (That exact thing cost an hour once.)

```bash
curl -o /dev/null -w "%{http_code}\n" --get --data-urlencode "token=$CALENDAR_TOKEN" \
  http://localhost:3000/api/calendar
```
