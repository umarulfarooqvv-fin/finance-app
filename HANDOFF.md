# Personal Finance Manager — Project Handoff Brief

> Give this file to any new Claude Code / Cowork chat working on this project.
> It explains what the system is, where everything lives, what's done, and
> what's next. The repo's `CLAUDE.md` has deeper architecture notes; this file
> is the orientation + current status. **Where the two disagree, this file
> wins** — `CLAUDE.md` still carries some pre-Supabase wording.

## What this is

Farooq's personal finance tracker. It **replaced a Google Sheets system** with
a Next.js web app backed by **Supabase (Postgres)**. He logs every expense from
an **iPhone Shortcut**, and the app computes credit-card statement cycles,
dues, forecasts, budgets, net worth, and full expense analytics.
Currency INR, locale en-IN, timezone IST, mobile-first.

## The reference Google Sheets (source-of-truth for FEATURES, not data)

The app's features replicate these two workbooks. When in doubt about how a
calculation should behave, open them and compare:

1. **Daily Spent** (raw entry log; fed by the old Google Form/Shortcut):
   https://docs.google.com/spreadsheets/d/1orMNGjhPKlKPTIQDKFcxd48Fip9K5Wuf5FdLkFWyimc/edit
   - Tab `Form Responses 1`: Timestamp | Amount | Method | Category | Remarks
   - Tab `Form Responses 2`: income (Timestamp | Payment Received | Source | Bank Account | Remarks)

2. **Financial Summary** (all the analysis; 20 tabs):
   https://docs.google.com/spreadsheets/d/1MOJfCY4DQCfvpfeXPl62DZsAoYemsM1zdP-wd1ZVllA/edit
   - `Statement_View` → app `/` (statements, dues, live debt, utilization)
   - `Card_Settings` → app `/cards` (limits, bill/due days, opening balances — already seeded)
   - `Daily Expense`, `Detailed Expenses`, `Summery of Income & Expense` → app `/detailed`
   - `Credit Cards` → app `/card/[name]`
   - `Savings`, `Investment` → app `/savings`
   - `Credit (Given)`, `Credits Raw Data` → app `/credit`
   - `Freelance`, `Fruitful Invoice Tracker`, `Client Wise` → app `/freelance`
   - `EventRecord` → app events audit log
   - `Credit (Taken)` → app `/credit-taken` (built Jul-2026; balances need entering)
   - `Email` → half-broken daily digest; app's `/api/alerts` push should absorb it
   - `Dashboard`, `Draft`, `Sheet44`, `Formula` → empty/scratch, ignore

**NOTE:** the sheets are no longer the data source. All data now lives in
Supabase; the sheets are kept for reference/comparison only.

## Where everything lives

| Thing | Location |
|---|---|
| Code (master copy) | `/Volumes/FQLab/Developer/Personal FInancial Manager/finance-app` (Farooq's Mac) |
| GitHub | https://github.com/umarulfarooqvv-fin/finance-app (branch `main`, auto-deploys) |
| Live app | https://finance-app-lemon-psi.vercel.app |
| Vercel project | team `umarulfarooqvv-2111s-projects`, project `finance-app`, **framework preset must stay "Next.js"** |
| Database | Supabase project `klefuwhalprydcavzgrr` (region ap-southeast-2 / Sydney) — https://supabase.com/dashboard/project/klefuwhalprydcavzgrr |
| Local dev | `npm run dev` → usually **port 3001** (another app squats on 3000) |

Environment variables (values live in Vercel → Settings → Environment
Variables, and in the gitignored `.env.local` on the Mac — never commit them):
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (secret — only Farooq pastes it),
`INGEST_TOKEN` (guards `/api/entry` + `/api/import`), plus legacy
`APPS_SCRIPT_URL`/`APPS_SCRIPT_TOKEN` (only needed to re-import sheet history).

## Current status (July 2026)

DONE: Supabase schema created; full history imported (**2,458 transactions +
30 income**, back to Feb-2023 era records); premium dark/light UI (sidebar +
mobile bottom tabs, design system in `app/globals.css`); deployed to Vercel
with GitHub auto-deploy; pagination fix for Supabase's 1000-row response cap
(`lib/store.js` — critical, do not remove); perf pass (no auto-resync on page
load, parallel bootstrap config hydration, `vercel.json` pins functions to
`syd1` next to the DB).

DONE 22-Jul-2026 (this pass):

- **PIN lock restored** — `middleware.js` is back, dependency-free and on the
  default Edge runtime. Verified locally: `/` 307s to `/lock`, API routes 401,
  `/api/lock` cookie unlocks. **It only arms when `APP_ACCESS_KEY` is set — set
  it in Vercel or the deploy stays public.**
- **Credit (Taken)** — `lib/debts.js` + `/credit-taken` + `/api/debts`, and
  `lib/networth.js` now subtracts outstanding borrowed money (snapshot *and*
  trend, which is date-aware via `debtsOutstandingAt()`). Balances still need
  entering from the sheet's `Credit (Taken)` tab.
- **`_to_delete/` untracked** — it held three complete stale copies of the app
  (~300 files) that were committed to git; every grep hit them. Untracked via
  `git rm -r --cached` (already in `.gitignore`); still on disk, safe to `rm`.
- `npm test` → 61 pass. `npm run lint` works again (devDependencies were
  missing from `node_modules`, so lint had been silently unrunnable).

## Pending / next work (in priority order)

1. **Set `APP_ACCESS_KEY` in Vercel** and confirm the deployed app locks. Until
   then the middleware is a no-op and the app is publicly reachable.
2. **Enter the Credit (Taken) balances** on `/credit-taken` from the sheet
   (Aliyanka ₹1.55L, Manaappa ₹70k, device EMIs…) so Net Worth is honest.
3. **iPhone Shortcut repoint** — the "Daily Spent" Shortcut still posts to the
   old Google Form. Replace its final URL+"Get contents of URL" steps with ONE
   POST to `https://finance-app-lemon-psi.vercel.app/api/entry`
   (Request Body: Form; fields `amount`, `method`, `category`, `remarks` — the
   existing Ask/Choose steps stay). Send the token as a **header**
   `x-token: <INGEST_TOKEN>`, not `?token=` — query strings are written to
   Vercel request logs. Income variant adds `type=income`, `source`, `account`.
4. **Numbers reconciliation vs sheet** — compare app Statements to the sheet's
   `Statement_View` card-by-card (sheet showed Total Debt ~₹64,795). Known
   quirk: Coral's opening balance nets against Cirqle-reimbursed EMIs in the
   sheet.
5. Daily digest push (absorb the sheet's `Email` tab into `/api/alerts`).
6. True per-debtor Excl.-Credit netting in `lib/cycles.js` (see CLAUDE.md).

## Hard-won gotchas (do not relearn these the hard way)

- **Supabase caps EVERY REST response at 1000 rows** — `lib/store.js#select()`
  paginates; any new direct queries must too.
- **Vercel framework preset** was once "Other" (created against an empty repo)
  → deployed only static files with the whole app 404ing. It must be "Next.js".
- **Root `middleware.js` cannot import `next/server` on this Vercel setup**
  (Edge runtime crashed with `__dirname is not defined`; Node runtime can't
  resolve `next/server`). It is dependency-free — keep it that way. Also do NOT
  put `runtime: 'nodejs'` in its config export: Node.js middleware is
  experimental in Next 15 and needs `experimental.nodeMiddleware`, and that
  line is the likeliest reason the earlier attempt failed to deploy.
- **Git push from the Mac is flaky**: macOS keychain sometimes serves the wrong
  GitHub identity (`vimecvalves` → 403). Retry usually works; fallback deploy
  is `npx vercel --prod` (answer **N** to the “overwrite .env.local?” prompt).
- ESLint errors fail Vercel builds; `next.config.mjs` sets
  `eslint.ignoreDuringBuilds` — lint via `npm run lint`. If lint says "ESLint
  must be installed", `node_modules` is missing devDependencies: run
  `npm install` (not `npm install --production`).
- **`_to_delete/` is gitignored but still on disk** — it contains old full
  copies of the app. Never edit or grep-match files under it; the live code is
  at the repo root.
- Timestamps are **local-naive IST strings**; never convert to UTC. Server
  stamps new entries via `istIso()` in `lib/parser.js`.
- Tests: `npm test` (node --test). Keep green.

## How data flows

iPhone Shortcut → `POST /api/entry` (token-guarded) → normalized row in
Postgres → a DB trigger bumps `app_state.version` → on the next request,
`ensureData()` sees the new version and reloads the in-process SQLite compute
cache → all pages/analytics read from that cache. Manual "Sync" button forces
a reload; `/api/import` re-imports the old sheet (safe to re-run, upserts).
