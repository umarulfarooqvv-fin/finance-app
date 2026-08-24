# v3 — state of play

Branch `rebuild/v3`. v2 is untouched on `main` and still deployable.
Your Supabase data was never migrated — the rewrite replaced the code that
reads it, not the records.

## Verification at a glance

```bash
npm test              # 107 offline tests
RUN_LIVE_TESTS=1 npm test   # + 4 against the real database
npm run typecheck
npm run lint
npm run check:privacy # also runs as part of build
npm run build
npm run gen:types     # regenerate src/types/database.ts from the live schema
```

## Done

| # | Item | State |
|---|---|---|
| 1 | Write path | create / edit / delete / restore / verify, verified live |
| 2 | `ActionResult` + `guardedAction` | guard is structural — skipping it does not compile |
| 3 | Validation & integrity | pure, server-side, plus DB constraints |
| 4 | Generated Supabase types | `npm run gen:types`, wired into the client |
| 5 | RLS + authorization + privacy | migration applied; privacy mode with a build gate |
| 6 | Constraints / indexes / migrations | applied and verified against the live DB |
| 7 | Financial calculation tests | 30 tests across reconciliation and calculations |
| 8 | Sticky identity columns | cards, ledgers, accounts, transactions |

### Correctness properties now guaranteed

- **Totals reconcile with the rows under them.** Amounts round to the paisa once,
  at the data boundary, so every sum is a sum of the numbers on screen.
- **A retry cannot duplicate.** Row ids derive from a client key minted per
  dialog opening. Proven against real Postgres.
- **Derived fields are never taken from the client.** `kind`, `card_affected`
  and `card_direction` are recomputed server-side.
- **Editing clears the verified tick**; **deletes are soft**.
- **Every change is audited twice** — once by the application with the actor,
  once by a database trigger that cannot be forgotten.
- **Forecasts never write back** to actuals (asserted by test).

## Bugs found and fixed

In v2, before the rewrite:

1. Timestamps regex-matched but never validated — `"32/13/2026"` became `"2026-32-13"`.
2. Day-of-month never clamped — `new Date(y, 1, 31)` rolls into March.
3. Any `n/m` in remarks became an EMI — "paid on 5/21" invented a 21-month plan.
4. `Excl. Credit` subtracted lending whether or not it had been repaid.
5. Card palette not colour-vision safe — Coral vs ICICI ΔE 10.4 in *normal* vision.
6. Monthly trend ran into the future, so the tail read as a collapse.
7. Derived columns read back from Postgres, freezing v2's rules into the data.

In v3, found by measuring rather than assuming:

8. **A ~2s stall on every request** — the store version check ran per page view
   (464ms from here to Sydney). Throttled to a 30s window: **1,960ms → 34–87ms**.
9. **Ten groupings whose rows did not add up to their total**, including the
   Coral card page and a three-row month.
10. **Twenty places where an amount would stay visible in privacy mode.**
11. Four latent type bugs surfaced by typing the client against the real schema.
12. The command palette closed without navigating (state set before `router.push`).

## Things about your data worth knowing

**Repayments are mostly unlogged.** ₹7,74,333 lent across 337 rows; roughly
₹1,87,640 recorded as returned. So ~₹5.86 lakh reads as outstanding and much of
it probably is not. Every screen says "not recorded as repaid" rather than
"unpaid", but it does flow into net worth — treat that figure as soft.

**`app_config` is empty.** Card limits, bill dates and opening balances are all
coming from `DEFAULT_CARDS` in code and have never been persisted. Account
balances stay meaningless until opening balances can be set — see item 9 below.

**Five rows have a blank payment method** and one has no timestamp. All are now
flagged for review rather than counting silently.

## Not built

9. **Settings write path.** Card limits, bill dates, opening balances and
   account opening balances are read-only. This is the highest-value gap now:
   `app_config` being empty is why Money shows an empty state.
10. **Import + duplicate detection.** `/api/import` is not rebuilt. Note that
    import-duplication and double-submit are *different* problems — the write
    path solves the second; the first needs near-duplicate detection, because
    two identical ₹10 rows on one day can be legitimate (your data has such a
    pair).
11. **Cron / alerts.** v2 pushed to ntfy for overdue cards at 02:30 UTC. Route
    not rebuilt; I removed the dangling `vercel.json` cron rather than ship a
    daily 404. Restore with:
    `"crons": [{ "path": "/api/alerts", "schedule": "30 2 * * *" }]`
12. **Recurring, budgets, savings/investments, freelance invoices, insights,
    export, PWA.** Present in v2, none rebuilt. Savings and investments are
    deliberately excluded from net worth: v2 carried a manual figure flat
    between updates, drawing a rising line during months when nothing changed.
13. **Natural-language entry.** `/ask` is read-only by design. A write path
    there should parse to a *draft the user confirms*, never a silent insert.

## Before deploying

- `ANTHROPIC_API_KEY` must be set for `/ask` (locally and in Vercel).
- `vercel.json` keeps `regions: ["syd1"]` so functions sit next to the database.
- The session cookie changed from `app_key` to `app_session` (it used to carry
  the PIN in plaintext), so **every signed-in device signs in once more**.
- `main` still holds v2, so rolling back is a branch switch.
