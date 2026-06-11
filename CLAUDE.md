# Personal Finance Manager — Claude Code context

Read `../FINANCE_APP_SPEC.md` for the full domain spec. This file covers what's
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
- **Tests**: `npm test` — 14 pass, incl. end-to-end on `tests/fixture.csv`
  (real sheet snapshot from 10-Jun-2026). Keep these green; add fixtures rather
  than weakening assertions.

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

- **Vercel-ready** (see DEPLOY.md): DB in `/tmp` when `process.env.VERCEL`,
  `lib/bootstrap.js#ensureData()` rebuilds the cache from the sheet on cold
  start (rows + AppMeta verified flags + AppConfig card settings — all GET
  APIs call it first). Card settings PUT pushes to the sheet's AppConfig tab
  via Apps Script `setConfig`. `middleware.js` locks public deployments behind
  `APP_ACCESS_KEY` (cookie set via `?key=`). Events table is ephemeral there.

## Known gaps / next milestones (spec §5 order)

1. Remaining §3.4 analytics: payment-method split charts, trip rollups, calendar heatmap.
2. Forecasting + Recommended Bank Reserve = Live Debt + Forecast (§3.5).
3. Credit Given ledger (per-debtor outstanding) — then replace the current
   approximate Excl.-Credit math in `lib/cycles.js` with true per-debtor netting.
4. Credit Taken + EMI tracker (§3.7), Savings/Investment (§3.8), Freelance/Cirqle (§3.9).
5. Open questions for Farooq: credit limits per card (utilization), grace-day
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
