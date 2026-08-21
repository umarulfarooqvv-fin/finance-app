# v3 rebuild — state of play

Branch `rebuild/v3`. v2 is untouched on `main` and still deployable.
Your Supabase data was never modified — the rewrite replaced the code that
reads it, not the records.

## Working

| Area | Route | State |
|---|---|---|
| Today | `/` | Reserve, what needs action, card strip, month, recent |
| Cards | `/cards`, `/cards/[name]` | Statement view, per-card ledgers, cycle maths |
| Spending | `/spending` | Categories, methods, daily, 24-month trend, trips |
| Transactions | `/spending/transactions` | Search, paging, upcoming toggle |
| Money | `/money` | Net worth, account balances, income |
| Ledgers | `/ledgers` | Credit given, credit taken, EMI plans |
| Ask | `/ask` | Plain-English questions (needs `ANTHROPIC_API_KEY`) |
| Settings | `/settings` | Read-only view of the config in use |
| Lock | `/lock` | PIN gate |
| Shortcut | `POST /api/entry` | Live; unchanged contract |

60 tests, typecheck clean, lint clean, production build passes.

## Bugs found and fixed during the rebuild

These were all live in v2:

1. **Timestamps were regex-matched, never validated.** `"32/13/2026 10:00"`
   produced the string `"2026-32-13"`.
2. **Day-of-month never clamped.** `new Date(y, 1, 31)` silently rolls into
   March, so a card billing after the 28th would bill on the wrong day. None of
   your six cards trigger it today; it was latent.
3. **Any `n/m` in remarks became an EMI.** "paid on 5/21" invented a
   21-instalment plan. Now requires a standard tenor or the word EMI.
4. **`Excl. Credit` was an approximation** that subtracted every credit-given
   charge whether or not it had been repaid, and whether or not it was still in
   the balance. Now: repayments allocate to lendings oldest-first, card payments
   settle charges oldest-first, and only the unpaid, unreturned part is
   excluded. Reads ₹20,627.80 of ₹49,940.30 rather than ₹3,765.98.
5. **The card palette was not colour-vision safe.** Coral and ICICI measured
   ΔE 10.4 in *normal* vision (floor is 15) — hard to tell apart for everyone.
6. **Monthly trend ran into the future.** Pre-logged EMI rows extended it to
   Feb 2027, so the line trailing to zero read as spending collapsing.
7. **Derived columns were read back from Postgres.** The whole credit history
   sat under one "Unassigned" debtor because v2 never wrote a person tag. Now
   classification is re-derived on load.

## Things about your data worth knowing

**Repayments are mostly unrecorded.** ₹7,74,333 has been lent out across 337
rows. Recorded repayments total roughly ₹1,87,640 (6 income rows + 10 Credit
Return transactions), so ~₹5.86 lakh reads as outstanding. Almost certainly
much of it came back as cash that was never logged. The UI says "not recorded
as repaid" rather than "unpaid" everywhere this figure appears, but it does
flow into net worth and into the excl-credit columns — treat both as soft.

**August has almost no entries.** The only August rows are the pre-logged Coral
EMI instalment, which is why this month shows −90% against July.

**Debtor names come from free text.** Grouping got 228 fragments down to 95, but
some entries are descriptions rather than people ("MacBook S f o r", "Microsoft
Vimec Valves"). `app_config.credit_status` already supports `assign` (per-row)
and `aliases` (name merging); the UI to edit them is not built.

## Not built

Ordered by what I would do next.

1. **Editing.** Everything is read-only. No add/edit/delete transaction, no
   card settings form, no account opening balances, no debtor merge UI. The
   domain and the API shapes are ready for it; the forms are not written.
   Account balances stay meaningless until opening balances can be set.
2. **Verification toggles.** The reconciliation split renders on each card, but
   nothing can flip a row's `verified` flag. `PATCH` on the transaction plus
   `invalidateSnapshot()` is the whole job.
3. **Alerts.** v2 had `/api/alerts` on a Vercel cron (02:30 UTC ≈ 08:00 IST)
   pushing to ntfy for overdue cards and due recurring items. The route is not
   rebuilt, so I removed the dangling cron from `vercel.json` rather than ship
   a daily 404. Re-add this when the route comes back:
   `"crons": [{ "path": "/api/alerts", "schedule": "30 2 * * *" }]`
4. **`/api/import`.** Exempted in middleware and referenced in docs, but not
   rebuilt — the one-time sheet import already ran, so this only matters if you
   want to re-import.
5. **Recurring module, budgets, savings/investments, freelance invoices,
   insights, backup/export, PWA.** All present in v2, none rebuilt. Savings and
   investments are deliberately excluded from net worth for now: v2 carried a
   manual figure flat between updates, which drew a rising line during months
   when nothing changed.
6. **Natural-language entry.** You asked for it; `/ask` is read-only by design
   and I would keep the write path separate — parse to a *draft* the user
   confirms, never a silent insert.

## To run it

```bash
npm run dev
```

For `/ask`, add `ANTHROPIC_API_KEY` to `.env.local` and to the Vercel project.
I cannot add that key for you.

## Before deploying

- `vercel.json` keeps `regions: ["syd1"]` so functions stay next to the
  database. The alerts cron was removed — see 3 above.
- Confirm the Shortcut still posts fine — the contract is unchanged, but it is
  worth one live entry to be sure.
- `main` still holds v2, so rolling back is a branch switch.
