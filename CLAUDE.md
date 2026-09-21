# Personal Finance Manager — Claude Code context

Read `docs/SPEC.md` for the domain spec. This file describes **v3**, a full
rewrite. `HANDOFF.md` lists what is done and what is not.

> **v2 is still on `main`.** This is branch `rebuild/v3`. To see how the old
> engine did something: `git show main:lib/cycles.js`.

## What this is

A personal finance app for one person (Farooq). Credit-card statement tracking,
spending analytics, ledgers for money lent and borrowed, EMI plans, voice
entry, and a plain-English question interface. Currency INR, locale en-IN,
timezone IST, used mostly on a phone.

Next 16 App Router, React 19, Server Components and Server Actions, Tailwind
v4, TypeScript strict. Supabase Postgres over PostgREST with plain `fetch` —
there is no Supabase SDK in the dependency tree.

## Architecture

```
src/
  lib/            the engine: money logic, data access, auth, write path
    ai/           local-parser, providers, parse-entry, ask, tools
  components/     ui/ primitives, layout/, charts/, entry/
  contexts/       client-side providers (theme, privacy)
  types/          database.ts — GENERATED, do not hand-edit
  app/            App Router pages, server actions, API routes
  proxy.ts        PIN lock (see the rules below — it must import nothing)
db/
  schema.sql      tables, unchanged from v2
  migrations/     001_integrity.sql — constraints, indexes, audit, RLS
tests/            vitest; stubs/ aliases `server-only`, integration/ is opt-in
scripts/          sheet sync, type generation, the privacy build gate
```

**Supabase Postgres is the source of truth.** The rewrite never migrated the
data, only the code that reads it, plus one additive integrity migration.

### The four rules that shape everything

1. **The money logic is pure.** `time`, `classify`, `cycles`, `statement`,
   `credit`, `debts`, `emi`, `analytics`, `forecast`, `balances`, `entry`,
   `money` and `reconcile` take a `Snapshot` and return a value. No network, no
   filesystem, no clock, no framework imports. That is why the engine is
   testable with plain objects and no database. `snapshot.ts`, `supabase.ts`,
   `config.ts` and `views.ts` are the only modules that touch the network.

2. **Derived columns in Postgres are a cache, not truth.** `kind`,
   `card_affected`, `card_direction` and `tags` are re-derived on load from the
   raw fields the user entered (`method`, `category`, `remarks`). Reading them
   back would freeze whichever app version wrote them into the data forever —
   exactly what left 2,468 historical rows classified by v2's rules. See the
   comment on `toTransaction` in `src/lib/snapshot.ts`.

3. **No `Date` in date arithmetic.** Timestamps are IST wall-clock strings
   (`YYYY-MM-DDTHH:MM:SS`, naive, no offset) and sort lexicographically. All
   calendar maths runs on integer y/m/d via `src/lib/time.ts`. `nowIST()` is the
   only function in the codebase that reads the host clock. A UTC Vercel box and
   an IST laptop agree by construction.

4. **Every write goes through `guardedAction`.** See below. This is not a
   convention — the type system enforces it.

### The write path

`src/lib/actions.ts` exports `guardedAction(opts, handler)`. The handler's
signature demands an `Actor`, and **only `requireSession()` produces one**, so
an action that skips the guard does not compile. Around every handler it does:
session check, Zod-free field validation (`validation.ts`), the mutation, an
audit `logEvent`, then `revalidatePath` over `MONEY_PATHS`.

Actions return `ActionResult<T>` (`src/lib/action-result.ts`) — never throw to
the client, never leak a SQLSTATE. `readable()` maps constraint violations to
sentences a person can act on.

Creates are idempotent: the id is derived from a client key minted once per
dialog opening, so a double-tap or a retry upserts instead of double-counting.

### Data flow

`getSnapshot()` (`src/lib/snapshot.ts`) loads transactions, income and
`app_config` into a plain object and caches it in module scope. Freshness costs
one query: a Postgres trigger bumps `app_state.version` on every write, and if
that number has not moved the cache is still exactly right. The version check
itself is throttled to 30s — it was costing ~2s per request against a remote
region. **After a write, `revalidatePath` runs, so nothing stale survives a
mutation.** `views.ts` wraps the derived views in React `cache()` for
per-request dedupe.

## Engine modules

| Module | What it owns |
|---|---|
| `time.ts` | Wall-clock instants, civil-date arithmetic, formatting |
| `types.ts` | `Transaction`, `Income`, `Card`, `Account`, `Snapshot` |
| `money.ts` | `parseUserAmount` (integer paise), `round2`, `MAX_AMOUNT` |
| `classify.ts` | Three timestamp formats, remarks tags, row classification |
| `cycles.ts` | Statement cycle geometry, due dates, status, boundary |
| `statement.ts` | The statement view; per-card detail; credit exclusion |
| `reconcile.ts` | Deducing the month's cut-off from the bank's own figure |
| `credit.ts` | Credit Given ledger, FIFO repayment allocation |
| `debts.ts` | Credit Taken (manual, from `app_config`) |
| `emi.ts` | Instalment plans regrouped from `n/m` remarks |
| `analytics.ts` | Spend definitions, breakdowns, series |
| `forecast.ts` | Run-rate projection, Recommended Bank Reserve |
| `balances.ts` | Account balances, net worth |
| `entry.ts` | Normalising a new entry from the Shortcut or the app |
| `validation.ts` | Field-level rules shared by every write |

### Definitions that are easy to get wrong

- **Spend means money consumed.** It excludes card bill payments (the charge
  was already counted), money lent to others, and transfers into savings or
  investments. Without this, a month with three bill payments looks like a
  spending disaster.
- **`totalDebtLive` can be negative.** An overpaid card is real; clamping it
  would misstate the reserve.
- **`remainingDueBill + unbilled === totalDebtLive`** is an accounting identity
  asserted across every card in the fixture. If it breaks, the dashboard is
  showing three numbers that cannot all be true.
- **Excluding credit given** means the part of the *currently unpaid* balance
  that was lent out and has not come back. Payments settle charges oldest-first;
  the unpaid tail is the balance. Summing every credit-given charge ever made is
  wrong once a bill has been paid.
- **The opening balance replaces history.** Rows older than a card's
  `openingDate` are skipped, not added.
- **Round once, at the data boundary.** `snapshot.ts` and `csv.ts` round on
  ingest; nothing downstream rounds again. Rounding twice made ten live
  groupings disagree with their own totals by a paisa.
- **Statement cycles chain.** If last month's statement *excluded* its own bill
  date, that day was never billed, so this cycle starts **on** it, not after it.
  No day may fall between two statements; a tiling invariant test asserts this.

## Integrations that are live — do not break these

- **`POST /api/entry`** — the iPhone "Daily Spent" Shortcut posts here.
  Form-encoded or JSON: `amount`, `method`, `category`, `remarks`, optional
  `type=income`. Auth via `INGEST_TOKEN` in the **`x-token` header** (query
  strings land in Vercel request logs). Ids are content-derived, so a retry
  upserts instead of double-counting.
- **`src/proxy.ts`** — the PIN lock (`APP_ACCESS_KEY`; unset = no lock).
  Next 16 renamed the `middleware` file convention to `proxy`. **Two rules,
  both from real deploy failures, asserted by `tests/proxy.test.ts`:**
  1. It must **import nothing**. `next/server` broke both runtimes.
  2. It must **not declare `runtime`**. On Next 15 `nodejs` was experimental
     and the deploy failed; on Next 16 Proxy defaults to Node and setting the
     option *throws*. Same rule, new reason.
  The session cookie holds a SHA-256 derivation, never the PIN itself.
- **Bulk import.** `/import` — paste many entries at once, preview and edit
  them in a table, then save through `importEntriesAction`. The prompt handed
  to an assistant lives in `lib/import-prompt` and carries the app's own
  method and category lists; `lib/import-parse` reads what comes back. (v2's
  `/api/import` does not exist in v3.)
- **Reminders.** `/reminders`, `/api/cron/reminders` (Vercel Cron, 08:00 IST)
  and `/api/calendar` (an .ics feed). See `docs/REMINDERS.md` — and note that
  `docs/DEPLOY.md` section 4 describes v2's ntfy alerts, which v3 does not have.
- **The Google Sheet.** `scripts/sheet-diff.mjs` and `scripts/sync-sheet.mjs`
  (dry-run by default; `--apply` to write). Matching is a **day-level multiset**
  on the natural key, not a set — the same amount, method and category twice in
  one day is a real thing that happens, and set matching would drop the second.
  The sync inserts and updates; it never deletes.

## Voice entry and the AI layer

Two separate paths, with different requirements:

- **Voice entry needs no key.** `src/lib/ai/local-parser.ts` is deterministic
  and offline: it handles Indian spoken amounts ("four eighty" is 480, not 84),
  method aliases, category keywords, and bill payments. It cannot hallucinate a
  payment method because it can only return one from the app's own list.
  `providers.ts` is an optional fallback for phrasing it cannot read, chosen by
  `ENTRY_AI`; one OpenAI-compatible adapter covers Groq, OpenRouter, Together,
  Mistral and a local Ollama. **A model may only fill fields the local parser
  left null — it never overwrites a deterministic reading**, and a failure or
  timeout leaves the local parse standing.
- **`/ask` needs `ANTHROPIC_API_KEY`.** There is no offline fallback; absent, it
  shows a setup message.

Neither path writes. They produce a draft that a person confirms, because
speech recognition mishears numbers routinely and a guessed payment method
silently moves debt onto the wrong card.

Audio never leaves the device — transcription is the Web Speech API on the
phone, and only the transcript is sent.

## Conventions

- TypeScript strict with `erasableSyntaxOnly`: **no enums, no parameter
  properties, no namespaces.**
- `src/types/database.ts` is **generated** from the live schema by
  `npm run gen:types`. Do not hand-edit it, and do not hand-roll row types
  beside it — four latent bugs were found the day the client became typed.
- Every money figure on screen uses the `.num` class (tabular numerals) and the
  `.sensitive` class so privacy mode can blur it. **`npm run build` fails if a
  money figure is missing `.sensitive`** — see `scripts/check-privacy.mjs`.
  Privacy mode is a CSS class driven by a `data-privacy` attribute, so it works
  inside SVG too.
- Card colours are **palette slots**, not hex — resolved to a themed CSS
  variable so they follow light/dark. The set is validated for colour-vision
  deficiency; do not hand-pick replacements without re-running the validator.
- Charts are hand-written SVG in `src/components/charts/charts.tsx`. No
  charting library.

## Commands

```bash
npm test          # vitest; 149 passing, 4 skipped (live tests are opt-in)
npm run typecheck
npm run lint
npm run build     # runs the privacy gate first, then next build
npm run gen:types # regenerate src/types/database.ts from the live schema
```

`RUN_LIVE_TESTS=1` enables `tests/integration/`, which talks to real Supabase.

`.claude/launch.json` has `next-dev` (respects the PIN) and `next-dev-open`
(runs with `APP_ACCESS_KEY=` so local verification is not gated).

## Environment

See `.env.example` for the full list with notes. The essentials:

- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — required; without them the app
  renders empty states rather than crashing. The service key is **server-only**.
- `INGEST_TOKEN` — guards `/api/entry`.
- `APP_ACCESS_KEY` — the PIN. Unset locally = no lock.
- `ENTRY_AI` — optional model fallback for voice entry. Default `off`.
- `ANTHROPIC_API_KEY` — required for `/ask` only.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
