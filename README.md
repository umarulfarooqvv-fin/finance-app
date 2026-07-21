# Personal Finance Manager

A mobile-first web app for tracking spending and credit cards. Data lives in
**Supabase (Postgres)**, and your **iPhone Shortcut posts entries directly** to
the app — so entry and refresh are near-instant. It computes credit-card
statements, dues, forecasts, budgets, net worth, and full expense analytics.

> Moving from an older Google-Sheets version? See [`docs/SUPABASE.md`](docs/SUPABASE.md)
> to create the database, import your history, and repoint the Shortcut.

> **Currency:** INR (₹) · **Locale:** en-IN · **Timezone:** IST · **Owner:** Farooq

---

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/SUPABASE.md`](docs/SUPABASE.md) | **Start here** — create the Supabase DB, import history, update the iPhone Shortcut |
| [`docs/SETUP.md`](docs/SETUP.md) | Install & run locally |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Deploy to Vercel via GitHub, env vars, push alerts |
| [`docs/SPEC.md`](docs/SPEC.md) | Full domain specification (the source of truth for behaviour) |
| [`CLAUDE.md`](CLAUDE.md) | Running record of what's built and the decisions behind it |
| [`SECURITY.md`](SECURITY.md) | Secret handling and token rotation |

---

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, INGEST_TOKEN
npm run dev                    # → http://localhost:3000
```

Create the database and import your history first — see
[`docs/SUPABASE.md`](docs/SUPABASE.md).

---

## What's implemented

**Core** — sheet sync (idempotent, never mutates the source), dual-format timestamp
parser, row classification (spend / card payment / credit given / EMI), the statement
cycle engine (billed vs unbilled, dues, days-left, utilization, excl-credit columns),
per-card statement panels with a verify/reconcile workflow, a transactions view with
add/edit/verify, card settings, and an event audit log.

**Analytics & planning** — Detailed Expenses (range picker, category breakdown,
month/year comparisons, daily & monthly trends), a Charts page, per-account Balances,
an Income tab, a Credit Given ledger, a Recurring-expenses module with due/upcoming
tracking and daily push alerts, spend forecasting with a recommended bank reserve,
category budgets with alerts, an EMI tracker, Savings & Investments (with goals),
Freelance/Cirqle invoices, a net-worth trend, and an Insights page (trip rollups,
daily-spend calendar heatmap, anomaly flags).

**Utility** — global search across everything, JSON/CSV backup & export, a
light/dark theme toggle, and installable-PWA support with offline read.

See [`CLAUDE.md`](CLAUDE.md) for the current status of each area and the roadmap.

---

## Stack

Next.js 15 (App Router, plain JS, ESM) · React 19 · **Supabase (Postgres)** via
its REST API (no DB driver dependency) · an in-process SQLite compute cache
(better-sqlite3) · Recharts. No CSS framework — a hand-rolled dark/light UI in
`app/globals.css`.

## Project layout

```
app/            Next.js routes — pages + API routes (thin wrappers)
components/     Shared UI (Nav, formatting helpers)
lib/            Domain logic — plain ESM, framework-free, unit-tested
apps-script/    Code.gs — the Google Sheets write proxy
tests/          node --test suites + a real sheet fixture
docs/           Setup, deploy, and the full spec
```

## Scripts

```bash
npm run dev        # start the dev server
npm run build      # production build
npm start          # run the production build
npm test           # run the test suite (node --test)
npm run lint       # ESLint (next/core-web-vitals)
npm run format     # Prettier — format all files
```

## Tests

```bash
npm test
```

Covers the timestamp parser (both formats + date-only), CSV parsing with embedded
newlines, row classification, cycle/statement math, analytics, the credit ledger,
recurring occurrences, and forecasting — run against a real sheet snapshot in
`tests/fixture.csv`. Keep them green; add fixtures rather than weakening assertions.

## License

Private — all rights reserved. See [`LICENSE`](LICENSE).
# finance-app
