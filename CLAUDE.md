# Personal Finance Manager — Claude Code context

Read `docs/SPEC.md` for the full domain spec. This file covers what's
already built and the decisions made so far. **Do not start from scratch — core v1
is complete and verified.**

## Current state (core v1 — working)

- Next.js 15 (App Router, plain JS, ESM `"type":"module"`) + better-sqlite3. No Tailwind —
  hand-rolled dark UI in `app/globals.css`.
- **Sync**: `lib/sync.js` pulls the Daily Spent sheet via the zero-auth CSV endpoint,
  idempotent upsert into SQLite (`data/finance.db`), soft-deletes vanished rows, never
  mutates the sheet. Auto-sync on dashboard load + "Sync now" button.
- **Parser** `lib/parser.js`: BOTH timestamp formats — legacy
  `" 08, March 26 at 03:58:47:71 PM"` (centiseconds, 2-digit year, `12:00:00:00 AM`
  = date-only) and `"5/21/2026 14:13:19"` (sheet switched format on 21-May-26).
  Row classification per spec §2.2; remarks tags (Trip/Cirqle/EMI n/m/cleared).
- **Cycle engine** `lib/cycles.js`: statement cycles per card, billed vs unbilled,
  Remaining Due, Total Debt (Live), Excl.-Credit columns, status chips, cycle-math block.
  Future-dated EMI rows (pre-logged through Feb 27) excluded until their date arrives.
- **Writes** go ONLY through the user's deployed Apps Script web app
  (`apps-script/Code.gs`, client `lib/sheets.js`): append/update columns A–E of
  `Form Responses 1`, verified flags in a separate `AppMeta` tab. Never touch the
  Google Form flow (iPhone Shortcut → Form → sheet must keep working).
  `.env.local` has the live URL + token (never commit; already gitignored).
- **Pages**: `/` Statement View dashboard; `/card/[name]` per-card panel (Bill vs
  Live ledgers, Verified/Unverified split, activity feed); `/transactions`
  (filters, add/edit modal, ✓ verify toggles); `/cards` settings.
- **Tests**: `npm test` — 38 pass, incl. end-to-end on `tests/fixture.csv`
  (real sheet snapshot from 10-Jun-2026). Keep these green; add fixtures rather
  than weakening assertions.

> **Note on local dev vs native module:** `better-sqlite3` is a native module.
> Use the Node version in `.nvmrc` (20). Tests, lint, and format are wired via
> `npm test` / `npm run lint` / `npm run format`, and CI runs them on push
> (`.github/workflows/ci.yml`).

## Environment facts

- Owner: Farooq. Currency INR, locale en-IN, timezone IST. Mobile-first usage.
- Daily Spent sheet ID: `1orMNGjhPKlKPTIQDKFcxd48Fip9K5Wuf5FdLkFWyimc`, tab `Form Responses 1`.
- `Jupiter` is a bank-like payment source (not in spec's enum) — treated like `Fi`.
- Timestamps are stored as **local-naive ISO strings** (no timezone) so day
  boundaries match the sheet's IST wall time. Don't convert to UTC.
- Sheet data starts 08-Mar-26; cards had pre-existing balances, so negative live
  debt can appear (the sheet behaves the same). A per-card opening-balance
  adjustment setting would fix this — good candidate feature.

- **Detailed Expenses** (`/detailed`, `lib/analytics.js`, `app/api/detailed/`):
  replicates the sheet's "Detailed Expenses" tab — range picker, category
  breakdown + % shares, comparisons (same-length window 1 month before; same
  dates 1 year ago), daily series with cumulative, monthly trend (includes
  future EMI projection months, like the sheet), grouped transaction list,
  category/method include-exclude toggles. Display categories add
  `Credit Card` (card payments), `Credit Return` (credit-given repayments,
  detected via remarks regex), and keyword-derived `Medicine`/`Groceries`.
  NOTE: the sheet's monthly history goes back to Jul-2024 but Daily Spent only
  has data from Mar-2026 (353 rows, verified via gviz count) — the older
  history lives somewhere in the Financial Summary workbook. Ask Farooq if he
  wants it imported (one-time backfill into the app DB or a new sheet tab).

- **Vercel-ready** (see docs/DEPLOY.md): DB in `/tmp` when `process.env.VERCEL`,
  `lib/bootstrap.js#ensureData()` rebuilds the cache from the sheet on cold
  start (rows + AppMeta verified flags + AppConfig card settings — all GET
  APIs call it first). Card settings PUT pushes to the sheet's AppConfig tab
  via Apps Script `setConfig`. `middleware.js` locks public deployments behind
  `APP_ACCESS_KEY` (cookie set via `?key=`). Events table is ephemeral there.

- **PIN lock**: `middleware.js` redirects to `/lock` (PIN form → `/api/lock` →
  cookie). PIN = `APP_ACCESS_KEY` env. `?key=` entry still works. `/api/alerts`
  is exempt (cron) and guarded by `CRON_SECRET` instead.
- **Recurring module** (`lib/recurring.js`, `/recurring`): user-defined defs
  (settings + AppConfig 'recurring') with occurrence engine — posted (matched
  by remarks LIKE name within the month) / due (date passed, one-tap "Post to
  sheet") / upcoming (never counted). Remarks template supports `{n}/{m}`
  installment counters. Sheet-prelogged future rows (iPad EMIs) are grouped as
  read-only "upcoming in sheet" series; they auto-activate when dated.
  Transactions list badges future rows as "upcoming".
- **Alerts**: `/api/alerts` + `vercel.json` cron (02:30 UTC ≈ 08:00 IST) →
  ntfy.sh push (`NTFY_TOPIC`) for Overdue/Due-Soon cards and due recurring items.

- **Income** (`/income`, income table): syncs `Form Responses 2`
  (Timestamp | Payment Received | Source of Income | Bank Account | Remarks),
  add-income writes to that tab via Apps Script `append` with `tab` param.
- **Balances** (`/balances`, `lib/balances.js`): per bank/cash account
  (Fi, Jupiter, SBI, Cash): opening_balance + income − outflows since the
  configurable "balance_since" date; cards show limit − live debt. Account
  config persists in AppConfig 'accounts'.
- **Charts** (`/charts`, recharts): category bars (this month), category trend
  lines, income-vs-expense bars, pies for card/account/income-source.
- **Credit Given ledger** (`/credit`, `lib/credit.js`): per-person grouping
  (manual assignment + fuzzy name match), mark received / partial / reopen,
  status persists in credit_status table mirrored to AppConfig 'credit_status'.
  Repayment suggestions from income 'Credit Return' + card payments mentioning
  credit given. NOTE: cycles.js "Excl. Credit" columns still use the window
  approximation — wiring them to true per-person outstanding is a good next step.

## Recently added modules (this pass)

- **Forecast + Recommended Reserve** (`lib/forecast.js`, `/forecast`,
  `/api/forecast`): month-to-date run-rate projected over remaining days, by
  card and by category, with an optional overlay of known recurring items.
  Recommended Bank Reserve = Total Debt (Live) + Estimated Spend Remaining (§3.5).
- **EMI tracker** (`lib/emi.js`, `/emi`, `/api/emi`): groups `n/m`-tagged rows
  into EMI items — installment amount, paid n of m, remaining, next due, card,
  fee (surcharge/tax) split, full schedule (§3.7).
- **Category budgets** (`lib/budgets.js`, `/budgets`, `/api/budgets`): monthly
  caps per display-category, progress vs pace, over/near flags; mirrored to
  AppConfig 'budgets'; over/near lines added to the daily `/api/alerts` push.
- **Savings & Investments** (`lib/holdings.js` `holdings` table, `/savings`,
  `/api/holdings`): manual CRUD, invested vs current value, gain (§3.8).
- **Freelance / Cirqle invoices** (`lib/holdings.js` `invoices` table,
  `/freelance`): client, number, amount, issued/due, draft/sent/paid, client
  rollup (§3.9).
- **Net worth** (`lib/networth.js`, `/networth`, `/api/networth`): snapshot
  (bank + savings + investments + credit-given outstanding − card debt) plus a
  monthly trend reconstructed from history (holdings carried flat — documented).
- New AppConfig keys (`budgets`, `holdings`, `invoices`) are hydrated on cold
  start in `lib/bootstrap.js`.
- **Insights** (`lib/insights.js`, `/insights`, `/api/insights`): trip-tagged
  spend rollups, a 6-month daily-spend calendar heatmap, and anomaly detection
  (this month's spends >2σ above the trailing 3-month per-category baseline).
- **Global search** (`lib/search.js`, `/search`, `/api/search`): across
  transactions, income, invoices, and holdings.
- **Backup / export** (`lib/exportData.js`, `/backup`, `/api/export`): full JSON
  snapshot + per-table CSV download.
- **Savings goals**: `holdings.target` column (migrated in `db.js`) + goal
  progress on `/savings`.
- **PWA**: `app/manifest.js`, `public/sw.js` (network-first offline cache),
  `components/RegisterSW.js`, icons in `public/`. Installable on phone.
- **Light/dark theme**: cookie-driven `data-theme` on `<html>` (SSR-set in
  `app/layout.js`), toggle in `Nav`, light palette in `globals.css`.
- `middleware.js` matcher now lets PWA assets (`manifest.webmanifest`, `sw.js`,
  icons) past the PIN lock.

## Known gaps / next milestones (spec §5 order)

1. Replace the approximate Excl.-Credit math in `lib/cycles.js` with true
   per-debtor netting from the Credit Given ledger (`lib/credit.js` already
   computes real per-person outstanding).
2. Open questions for Farooq: credit limits per card (utilization), grace-day
   confirmation, and the Financial Summary .xlsx export to match formulas 1:1
   (esp. Coral's opening balance, which the sheet seems to net against
   Cirqle-reimbursed EMIs — ours shows the full carried balance).

## Conventions

- Server logic in `lib/` (plain ESM, no framework imports) so it stays testable
  with `node --test`. API routes in `app/api/**` are thin wrappers.
- All money values rounded to 2dp at the edge (`round2`), `en-IN` formatting via
  `components/format.js`.
- Annotations (verified flags) are keyed by tx id = hash of (sheetRow + raw cells);
  on row edits the annotation is carried over by sheet_row in `lib/sync.js`.
- Audit every mutating action via `logEvent()` (events table, spec §3.10).
