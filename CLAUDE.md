# Personal Finance Manager — Claude Code context

Read `docs/SPEC.md` for the full domain spec. This file covers what's
already built and the decisions made so far. **Do not start from scratch — core v1
is complete and verified.**

## Data backend — Supabase (Postgres), v2

The app moved off Google Sheets. **Supabase Postgres is the source of truth**
and the iPhone Shortcut posts entries directly to `/api/entry`.

- `lib/store.js` — dependency-free Supabase REST (PostgREST) client over `fetch`
  (env `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`). `db/schema.sql` = the tables
  (`transactions`, `income`, `app_config`, `events`, `app_state`).
- `lib/sheets.js` — reimplemented on the store but keeps its old exported API
  (writesEnabled/getConfig/setConfig/getMeta/setMeta/appendRow/updateRow), so
  every downstream module is unchanged. Config (cards, budgets, recurring,
  holdings, invoices, credit-status, accounts) is JSON in `app_config`.
- `lib/sync.js#loadFromStore()` pulls transactions+income from Postgres into the
  SQLite compute cache; the whole analytics/credit engine runs over the cache
  unchanged. `lib/bootstrap.js#ensureData()` reloads only when a DB-trigger
  version counter (`app_state`) changes — warm requests do zero work.
- **Ingestion**: `POST /api/entry` (form-encoded or JSON: amount/method/category/
  remarks [+type=income]) → normalized + inserted into Postgres. Token-guarded by
  `INGEST_TOKEN`, exempt from the PIN lock. Timestamp set server-side in IST
  (`parser.istIso`, UTC-safe for Vercel).
- **History import**: `POST /api/import` reads the full sheet (filter-proof via
  Apps Script if configured, else CSV) and upserts into Postgres. One-time.
- Setup + the exact iPhone Shortcut change: `docs/SUPABASE.md`.

## Current state (engine — working)

- Next.js 15 (App Router, plain JS, ESM `"type":"module"`) + better-sqlite3 as an
  in-process compute cache. Dark/light UI in `app/globals.css`.
- `lib/sync.js#syncFromSheet()` (CSV → SQLite) is retained only for tests and as
  the reader behind the history importer.
- **Parser** `lib/parser.js`: BOTH timestamp formats — legacy
  `" 08, March 26 at 03:58:47:71 PM"` (centiseconds, 2-digit year, `12:00:00:00 AM`
  = date-only) and `"5/21/2026 14:13:19"` (sheet switched format on 21-May-26).
  Row classification per spec §2.2; remarks tags (Trip/Cirqle/EMI n/m/cleared).
- **Cycle engine** `lib/cycles.js`: statement cycles per card, billed vs unbilled,
  Remaining Due, Total Debt (Live), Excl.-Credit columns, status chips, cycle-math block.
  Future-dated EMI rows (pre-logged through Feb 27) excluded until their date arrives.
- **Writes** go to Supabase through `lib/store.js` (behind the old `lib/sheets.js`
  API). The Apps Script web app (`apps-script/Code.gs`) is LEGACY — it is only
  reachable when `APPS_SCRIPT_URL`/`APPS_SCRIPT_TOKEN` are set, and its only
  remaining job is the one-time sheet history import (`POST /api/import`).
- **Pages**: `/` Statement View dashboard; `/card/[name]` per-card panel (Bill vs
  Live ledgers, Verified/Unverified split, activity feed); `/transactions`
  (filters, add/edit modal, ✓ verify toggles); `/cards` settings.
- **Tests**: `npm test` — 61 pass, incl. end-to-end on `tests/fixture.csv`
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
  NOTE (resolved Jul-2026): the older history WAS imported — Supabase now holds
  2,458 transactions + 30 income rows going back to the Feb-2023 era, so the
  monthly trend no longer starts at Mar-2026.

- **Vercel-ready** (see docs/DEPLOY.md): DB in `/tmp` when `process.env.VERCEL`,
  `lib/bootstrap.js#ensureData()` rebuilds the cache from Supabase on cold start
  (rows + all `app_config` blobs — every GET API calls it first). Config writes
  go to `app_config` via `setConfig`. Events table is ephemeral there.

- **PIN lock**: `middleware.js` redirects to `/lock` (PIN form → `/api/lock` →
  cookie). PIN = `APP_ACCESS_KEY` env; unset (local dev) = no lock. `?key=`
  entry still works. `/api/entry` (Shortcut, `INGEST_TOKEN`) and `/api/alerts`
  (cron, `CRON_SECRET`) are exempt and carry their own auth.
  Two rules keep it deployable, both learned from crashes: the file must import
  NOTHING (no `next/server`), and it must NOT declare `runtime: 'nodejs'`
  (experimental in Next 15 — the deploy fails). See the header comment.
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
- **Credit Taken** (`lib/debts.js`, `debts` + `debt_payments` tables,
  `/credit-taken`, `/api/debts`): the sheet's `Credit (Taken)` tab — who Farooq
  owes, principal, repayments, Balance to Pay. Manual CRUD (nothing in the
  transaction log marks a borrowing), mirrored to app_config 'debts' /
  'debt_payments'. `debtsOutstandingAt()` makes the balance date-aware so the
  net-worth trend can reconstruct it month by month.
- **Net worth** (`lib/networth.js`, `/networth`, `/api/networth`): snapshot
  (bank + savings + investments + credit-given outstanding − card debt −
  credit-taken outstanding) plus a monthly trend reconstructed from history
  (holdings carried flat — documented; borrowed money is properly dated).
- New AppConfig keys (`budgets`, `holdings`, `invoices`, `debts`,
  `debt_payments`) are hydrated on cold start in `lib/bootstrap.js`.
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

## Sheet findings applied (from Card_Settings / history audit)

- **Real card config** seeded into `DEFAULT_CARDS` + `cards` table from the
  Financial Summary `Card_Settings` tab: credit limits (Edge/ICICI/Coral 50k,
  One Card 115k, Scapia 48k, Super Money 2452.5), a `due_day` + `due_cycle`
  ('same'|'next' month) due-date model, and per-card `opening_balance` +
  `opening_date` (carried debt on the track-start date). `lib/cycles.js` uses
  the due model (falls back to `grace_days`) and adds the opening balance while
  bounding debt sums to `ts >= opening_date` so pre-tracking history isn't
  double-counted. A one-time migration populates these for existing zero-limit
  cards without overriding user edits.
- **Older-history parsing** (`Form Responses 1` goes back to Jul-2024): the
  parser now handles the literal `Credit Card` category (bill payment, target
  card read from remarks), an `Investment` category (kind `investment`, excluded
  from spend everywhere), `Medicine`/`Groceries` as real spend categories, and
  `SBI`/`RBL`/`Canara` as non-card money sources.
- **Savings & Investment seeded** into `holdings` from the Savings/Investment
  tabs (aggregate starting values, editable in `/savings`).

## Known gaps / next milestones (spec §5 order)

1. Repoint the iPhone "Daily Spent" Shortcut off the Google Form onto
   `POST /api/entry` — send the token as the `x-token` HEADER, not `?token=`
   (query strings land in Vercel's request logs). See docs/SUPABASE.md.
2. Reconcile app statements against the sheet's `Statement_View` card by card
   (the sheet showed Total Debt ≈ ₹64,795 at handoff time).
3. Replace the approximate Excl.-Credit math in `lib/cycles.js` with true
   per-debtor netting from the Credit Given ledger (`lib/credit.js` already
   computes real per-person outstanding).
4. Absorb the sheet's `Email` tab (daily digest) into the `/api/alerts` push.
5. Open questions for Farooq: grace-day
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
