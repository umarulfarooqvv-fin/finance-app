# Personal Finance Manager — Claude Code context

Read `docs/SPEC.md` for the domain spec. `HANDOFF.md` lists what is done and
what is not.

> **v2 is still on `main`.** This is branch `rebuild/v3`. To check how the old
> engine did something: `git show main:lib/cycles.js`.

## What this is

A personal finance app for one person (Farooq). Credit-card statement tracking,
spending analytics, ledgers for money lent and borrowed, EMI plans, voice
entry, and a plain-English question interface. Currency INR, locale en-IN,
timezone IST, used mostly on a phone.

## Architecture

```
src/
  lib/              all business logic — framework-free and testable
    ai/             Claude API: ask() and the voice-entry parser
  components/
    ui/             generic primitives (button, dialog, field, toast, table)
    layout/         nav, page header, theme and privacy toggles
    charts/         hand-written SVG charts
    entry/          voice capture
  contexts/         privacy provider
  types/            generated DB types (npm run gen:types)
  app/              routes only — orchestrate, never compute
  proxy.ts          the PIN lock
tests/              vitest; tests/integration/ is opt-in and hits the real DB
scripts/            maintenance tools (sheet sync, type generation, checks)
db/migrations/      numbered SQL, applied by hand in the Supabase editor
```

**Supabase Postgres is the source of truth.**

### The rules that shape everything

1. **`src/lib/` is pure where it can be.** The money engine takes a `Snapshot`
   and returns a value — no network, no clock, no framework imports. That is
   why it is testable with plain objects and no database. Modules that must do
   I/O (`supabase`, `snapshot`, `transactions`, `ai/`) are marked `server-only`.

2. **Routes orchestrate; `lib/` computes.** `src/app/**` may fetch, guard,
   strip and render. Anything that computes a number or applies a business rule
   lives in `lib/` and is unit-testable without Next.js.

3. **Derived columns in Postgres are a cache, not truth.** `kind`,
   `card_affected`, `card_direction` and `tags` are re-derived on load from the
   raw fields the user entered. Reading them back would freeze whichever app
   version wrote them into the data forever. See `toTransaction` in
   `src/lib/snapshot.ts`.

4. **No `Date` in date arithmetic.** Timestamps are IST wall-clock strings
   (`YYYY-MM-DDTHH:MM:SS`, naive) that sort lexicographically. All calendar
   maths runs on integer y/m/d via `src/lib/time.ts`. `nowIST()` is the only
   function that reads the host clock, so a UTC Vercel box and an IST laptop
   agree by construction.

5. **Money rounds once, at the data boundary.** `snapshot.ts` and the CSV
   importer round to the paisa on the way in, so every downstream sum is a sum
   of the numbers actually on screen. This was a real defect: ten groupings had
   rows that did not add up to their own total.

6. **A write cannot skip the guard.** `guardedAction` demands an `Actor`, and
   only `requireSession()` produces one, so a handler that skips the check does
   not compile.

### Data flow

`getSnapshot()` loads transactions, income and `app_config` into a plain object
cached in module scope. A Postgres trigger bumps `app_state.version` on every
write; the check is throttled to a 30-second window, because running it per
request put a full network round-trip under every render. Local writes call
`invalidateSnapshot()` and are visible immediately. Derived views go through
`src/lib/views.ts`, which wraps them in React `cache()` — `forecast()` calls
`statementView()` internally, so without it the engine runs twice per render.

## Domain modules (`src/lib/`)

| Module | What it owns |
|---|---|
| `time.ts` | Wall-clock instants, civil-date arithmetic, formatting |
| `money.ts` | Exact paise parsing, `round2`, rounding policy |
| `types.ts` | `Transaction`, `Income`, `Card`, `Account`, `Snapshot` |
| `classify.ts` | Three timestamp formats, remarks tags, row classification |
| `cycles.ts` | Statement geometry, due dates, the statement boundary |
| `statement.ts` | Statement view, per-card detail, credit exclusion |
| `reconcile.ts` | Deducing the cut-off from the bank's own figure |
| `credit.ts` | Credit Given ledger, FIFO repayment allocation |
| `debts.ts` | Credit Taken (manual, from `app_config`) |
| `emi.ts` | Instalment plans regrouped from `n/m` remarks |
| `analytics.ts` | Spend definitions, breakdowns, series |
| `forecast.ts` | Run-rate projection, Recommended Bank Reserve |
| `balances.ts` | Account balances, net worth |
| `validation.ts` | Server-side entry rules |
| `transactions.ts` | Create / update / delete, idempotent and audited |
| `auth.ts`, `actions.ts` | The authorization boundary and `guardedAction` |

### Definitions that are easy to get wrong

- **Spend means money consumed.** It excludes card bill payments, money lent to
  others, and transfers into savings. Without this, a month with three bill
  payments reads as a spending disaster.
- **`totalDebtLive` can be negative.** An overpaid card is real.
- **`remainingDueBill + unbilled === totalDebtLive`** is an accounting identity
  asserted across every card in the fixture.
- **A total on screen must equal the sum of the rows on screen.** Asserted
  across every grouping the UI aggregates by.
- **Excluding credit given** means the part of the *currently unpaid* balance
  that was lent out and has not come back. Payments settle charges oldest-first.
- **The opening balance replaces history.** Rows older than `openingDate` are
  skipped, not added.
- **`statementEnd` is the date printed on the statement; `periodEnd` is where
  the spending stops.** They differ by a day when the boundary is exclusive.
  The debt cut-off uses `periodEnd`. Cycle boundaries CHAIN — a cycle's start
  depends on the previous cycle's boundary — or a day falls on no statement at
  all and vanishes from both.

## Integrations that are live — do not break these

- **`POST /api/entry`** — the iPhone Shortcut. Form-encoded or JSON: `amount`,
  `method`, `category`, `remarks`, optional `type=income`. Auth via
  `INGEST_TOKEN` in the **`x-token` header**. Ids are content-derived, so a
  retry upserts instead of double-counting.
- **`src/proxy.ts`** — the PIN lock (`APP_ACCESS_KEY`; unset = no lock). Next
  16 renamed the `middleware` convention to `proxy`. **Two rules, from real
  deploy failures, asserted by tests:** it must import nothing, and it must not
  declare a `runtime` (Next 16 throws). The session cookie holds a SHA-256
  derivation, never the PIN. That derivation is duplicated in `lib/auth.ts`
  because proxy may not import — a contract test pins them together.

## Conventions

- TypeScript strict, `erasableSyntaxOnly`: no enums, no parameter properties.
- **Every money figure on screen goes through `<Money>` or `<Private>`.**
  `npm run check:privacy` fails the build otherwise, because privacy mode is
  only a single switch if every amount passes one choke point.
- Card colours are **palette slots**, not hex, validated for colour-vision
  deficiency. Do not hand-pick replacements without re-running the validator.
- Charts are hand-written SVG. No charting library.
- Maintenance scripts import app modules via `scripts/register-alias.mjs`, so a
  script cannot drift from the engine it is checking.

## Commands

```bash
npm test                    # 130 offline tests
RUN_LIVE_TESTS=1 npm test   # + integration tests against the real database
npm run typecheck
npm run lint
npm run check:privacy
npm run build               # runs the privacy gate first
npm run gen:types           # regenerate src/types/database.ts from the live schema
```

`.claude/launch.json` has `next-dev` (respects the PIN) and `next-dev-open`
(runs with `APP_ACCESS_KEY=` so local verification is not gated).

## Environment

- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — required; without them the app
  renders empty states rather than crashing.
- `INGEST_TOKEN` — guards `/api/entry`.
- `APP_ACCESS_KEY` — the PIN. Unset locally = no lock.
- `ANTHROPIC_API_KEY` — required for `/ask` and voice entry. Absent = a clear
  setup message, never a crash.
