# Personal Finance Manager

Replaces the **Financial Summary** workbook with a local web app. The **Daily
Spent** Google Sheet stays the single source of truth — the Google Form /
iPhone Shortcut keep feeding it; this app reads it, lets you add/edit/verify,
and computes statements.

See `SETUP.md` to get running. Spec: `../FINANCE_APP_SPEC.md`.

## What's implemented (core v1)

| Area | Status |
|---|---|
| Sheet sync (CSV endpoint, idempotent, never mutates the sheet) | ✅ auto on load + "Sync now" |
| Timestamp parser — both formats (`08, March 26 at 03:58:47:71 PM` and `5/21/2026 14:13:19`) | ✅ + date-only `12:00:00:00 AM` rule |
| Row classification (spend / card_payment / credit_given / emi) incl. "Category = card name → bill payment" | ✅ |
| Remarks tags: `(Trip …)`, `(Cirqle)`, `n/24` EMI counters, cleared/repayment | ✅ |
| Statement View: cycles, due dates, days left, Remaining Due, Total Debt (Live), Unbilled, Excl.-Credit columns, KPIs, status chips, utilization bars | ✅ |
| Per-card panels: cycle math block, Live/Unbilled + Bill ledger views, Verified/Unverified split, sorting, activity timeline | ✅ |
| Transactions: filters/search, **Add** + **Edit** (writes to the sheet via Apps Script), ✓ verify toggles | ✅ |
| Verified flags persisted to the sheet's **AppMeta** tab (survives reinstalls/devices) | ✅ |
| Card settings CRUD (bill date, grace days, credit limit, active) | ✅ |
| Event audit log (`events` table) | ✅ |
| Future-dated EMI rows excluded until their date arrives | ✅ |

Not yet (next milestones per spec §5): monthly analytics charts, forecasting +
Recommended Reserve, Credit Given/Taken ledgers, EMI tracker pages,
Savings/Investment/Freelance modules.

## Notes & known approximations

- **Excl.-Credit columns** subtract Credit-Given amounts within each window
  (billed / unbilled). The sheet nets repayments per debtor; once the Credit
  Given ledger module lands, these will use true outstanding-per-debtor.
- `Jupiter` appears in your data as a bank-like source (used to clear cards);
  it's treated like `Fi`. `Perks` = reward points, also a non-card source.
- Rows with blank amounts or unparseable timestamps are kept, flagged
  (amber in the Transactions list), and excluded from balance math.
- Local DB is `data/finance.db` (SQLite). Delete it any time — everything
  except *unsynced* annotations rebuilds from the sheet + AppMeta.

## Stack

Next.js 15 (App Router, JS) · better-sqlite3 · no CSS framework (hand-rolled
dark UI) · Apps Script web app as the only write path to Google Sheets.

## Tests

```bash
npm test
```

Covers the timestamp parser (both formats + date-only), CSV parsing with
embedded newlines, classification rules, and EMI/trip/Cirqle tag extraction.
