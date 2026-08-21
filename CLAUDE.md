# Personal Finance Manager — Claude Code context

Read `docs/SPEC.md` for the domain spec. This file describes **v3**, a full
rewrite. `HANDOFF.md` lists what is done and what is not.

> **v2 is still on `main`.** This is branch `rebuild/v3`. If you need to check
> how the old engine did something: `git show main:lib/cycles.js`.

## What this is

A personal finance app for one person (Farooq). Credit-card statement tracking,
spending analytics, ledgers for money lent and borrowed, EMI plans, and a
plain-English question interface. Currency INR, locale en-IN, timezone IST,
used mostly on a phone.

## Architecture

```
src/
  domain/     pure, dependency-free money logic — the whole engine
  data/       Supabase access + the in-memory snapshot cache
  ui/         design system + shared components
  ai/         Claude API tools and the ask() entry point
  app/        Next.js App Router pages and API routes
  middleware.ts   PIN lock (see the rules below — it must import nothing)
tests/        node --test over TypeScript directly, no build step
```

**Supabase Postgres is the source of truth.** `db/schema.sql` is unchanged from
v2 — the rewrite never touched the data, only the code that reads it.

### The three rules that shape everything

1. **`domain/` is pure.** No network, no filesystem, no clock, no framework
   imports. Every function takes a `Snapshot` and returns a value. That is why
   the engine is testable with plain objects and no database.

2. **Derived columns in Postgres are a cache, not truth.** `kind`,
   `card_affected`, `card_direction` and `tags` are re-derived on load from the
   raw fields the user entered (`method`, `category`, `remarks`). Reading them
   back would freeze whichever app version wrote them into the data forever —
   this is exactly what left 2,468 historical rows classified by v2's rules.
   See the comment on `toTransaction` in `src/data/snapshot.ts`.

3. **No `Date` in date arithmetic.** Timestamps are IST wall-clock strings
   (`YYYY-MM-DDTHH:MM:SS`, naive, no offset) and sort lexicographically. All
   calendar maths runs on integer y/m/d via `src/domain/time.ts`. `nowIST()` is
   the only function in the codebase that reads the host clock. This makes a
   UTC Vercel box and an IST laptop agree by construction.

### Data flow

`getSnapshot()` (`src/data/snapshot.ts`) loads transactions + income +
`app_config` into a plain object and caches it in module scope. Freshness costs
one query: a Postgres trigger bumps `app_state.version` on every write, and if
that number has not moved the cache is still exactly right. There is **no
SQLite, no native module, no bootstrap step** — v2's compute cache existed to
run SQL over half a megabyte of data.

## Domain modules

| Module | What it owns |
|---|---|
| `time.ts` | Wall-clock instants, civil-date arithmetic, formatting |
| `types.ts` | `Transaction`, `Income`, `Card`, `Account`, `Snapshot` |
| `classify.ts` | Three timestamp formats, remarks tags, row classification |
| `cycles.ts` | Statement cycle geometry, due dates, status |
| `statement.ts` | The statement view; per-card detail; credit exclusion |
| `credit.ts` | Credit Given ledger, FIFO repayment allocation |
| `debts.ts` | Credit Taken (manual, from `app_config`) |
| `emi.ts` | Instalment plans regrouped from `n/m` remarks |
| `analytics.ts` | Spend definitions, breakdowns, series |
| `forecast.ts` | Run-rate projection, Recommended Bank Reserve |
| `balances.ts` | Account balances, net worth |
| `entry.ts` | Normalising a new entry from the Shortcut or the app |

### Definitions that are easy to get wrong

- **Spend means money consumed.** It excludes card bill payments (the charge
  was already counted), money lent to others, and transfers into savings or
  investments. Without this, a month with three bill payments looks like a
  spending disaster.
- **`totalDebtLive` can be negative.** An overpaid card is real; clamping it
  would misstate the reserve.
- **`remainingDueBill + unbilled === totalDebtLive`** is an accounting identity
  asserted by tests across every card in the fixture. If it breaks, the
  dashboard is showing three numbers that cannot all be true.
- **Excluding credit given** means the part of the *currently unpaid* balance
  that was lent out and has not come back. Payments settle charges oldest-first;
  the unpaid tail is the balance. Summing every credit-given charge ever made
  is wrong once a bill has been paid.
- **The opening balance replaces history.** Rows older than a card's
  `openingDate` are skipped, not added.

## Integrations that are live — do not break these

- **`POST /api/entry`** — the iPhone "Daily Spent" Shortcut posts here.
  Form-encoded or JSON: `amount`, `method`, `category`, `remarks`, optional
  `type=income`. Auth via `INGEST_TOKEN` in the **`x-token` header** (query
  strings land in Vercel request logs). Ids are content-derived, so a retry
  upserts instead of double-counting.
- **`src/middleware.ts`** — the PIN lock (`APP_ACCESS_KEY`; unset = no lock).
  **Two rules, both from real deploy failures, asserted by tests:**
  1. It must **import nothing**. `next/server` broke both runtimes.
  2. It must **not declare `runtime: 'nodejs'`** — experimental in Next 15;
     the deploy fails.
  The session cookie holds a SHA-256 derivation, never the PIN itself.

## Conventions

- TypeScript, strict, `erasableSyntaxOnly` — tests run under `node --test`
  with native type stripping, so **no enums, no parameter properties, no
  namespaces**.
- Money rounded to 2dp at the edge (`round2`), formatted via `src/ui/format.ts`.
- Every money figure on screen uses the `.num` class (tabular numerals).
- Card colours are **palette slots**, not hex — resolved to a themed CSS
  variable so they follow light/dark. The set is validated for colour-vision
  deficiency; do not hand-pick replacements without re-running the validator.
- Charts are hand-written SVG in `src/ui/Charts.tsx`. No charting library.

## Commands

```bash
npm test        # 60 tests, node --test over TypeScript directly
npm run typecheck
npm run lint
npm run build
```

`.claude/launch.json` has `next-dev` (respects the PIN) and `next-dev-open`
(runs with `APP_ACCESS_KEY=` so local verification is not gated).

## Environment

- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — required; without them the app
  renders empty states rather than crashing.
- `INGEST_TOKEN` — guards `/api/entry` and `/api/import`.
- `APP_ACCESS_KEY` — the PIN. Unset locally = no lock.
- `ANTHROPIC_API_KEY` — required for `/ask`. Absent = a clear setup message.
