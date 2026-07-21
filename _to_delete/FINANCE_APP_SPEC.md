# Personal Finance Manager — App Specification

> **Purpose:** Build a web application that replicates and replaces the Google Sheets workbook
> **"Financial Summary"**, using the Google Sheet **"Daily Spent"** (Form Responses 1) as the
> single source of truth / database.
>
> **Built for:** Claude Code. Read this entire file before writing any code.
> **Owner:** Farooq
> **Currency:** INR (₹) | **Locale:** en-IN | **Timezone:** Asia/Kolkata (IST)

---

## 1. System Overview

The current setup is a two-layer pipeline:

1. **Capture layer — "Daily Spent" sheet.** A Google Form writes every transaction
   (expense, credit-card bill payment, credit given to friends/family, EMI, etc.) as a new
   row into the `Form Responses 1` tab. Entry must stay fast and frictionless.
2. **Analytics layer — "Financial Summary" sheet.** Pulls the raw rows and computes:
   per-credit-card statement cycles, billed vs unbilled debt, dues & due-date countdowns,
   utilization %, payment status flags, monthly category breakdowns, spend forecasting,
   a recommended bank reserve, plus side ledgers (Credit Given, Credit Taken, EMI,
   Savings, Investment, Freelance invoicing).

**The app must keep layer 1 untouched** (the Google Form keeps feeding the sheet) and
**replace layer 2 entirely** with a proper application.

### Source documents

| Sheet | ID | Role |
|---|---|---|
| Daily Spent | `1orMNGjhPKlKPTIQDKFcxd48Fip9K5Wuf5FdLkFWyimc` | DATABASE (read) |
| Financial Summary | `1MOJfCY4DQCfvpfeXPl62DZsAoYemsM1zdP-wd1ZVllA` | Feature reference (to be replaced) |

Both are shared as "anyone with link can edit."

---

## 2. Database: "Daily Spent" → `Form Responses 1`

### 2.1 Raw schema (as it exists in the sheet)

| Col | Field | Type | Notes |
|---|---|---|---|
| A | Timestamp | string | Custom format: `"DD, Month YY at HH:MM:SS:cc AM/PM"` e.g. `11, March 26 at 08:06:31:04 PM`. Some rows use `12:00:00:00 AM` (date-only entries). **Must write a robust parser.** |
| B | Enter Payment Made | number | Amount in ₹. **Can be blank** (incomplete entries exist — handle gracefully, flag for review). |
| C | Payment Method | enum | Observed: `Fi`, `Edge`, `ICICI`, `Scapia`, `Coral`, `One Card`, `Super Money`, `Cash`, `Perks`. `Fi` = bank account (UPI), `Cash` = cash, `Perks` = credit-card reward points, the rest are credit cards. |
| D | Category of Payment | enum | Spend categories: `Family`, `Food`, `Fuel`, `Personal`, `Credit Given`, `Gifts/Donations`, `Maintenance`, `Entertainment`, `Surcharge`, `Taxes`. **Special:** when Category = a card name (`ICICI`, `Scapia`, `Coral`, `Edge`, `One Card`, `Super Money`), the row is a **payment TO that card** (bill clearance), not a spend. |
| E | Remarks | string | Free text. Carries embedded semantics (see 2.3). |
| F–H | Header stats | — | Row 1 only: `Status : <total>`, `Expected : <n>`, `Balance : <n>` — computed cells in the sheet header; the app recomputes these itself. |

Sheet currently has **~2,030+ rows** and grows daily. Other tabs in this workbook
(`Sheet7`, `Frequency`, `Spents Frequency`, `DateSelection`, `EMI`) are helper/analysis
tabs — their functionality is absorbed by the app (see Features), they are NOT extra data sources.

### 2.2 Normalized data model (app-side)

Ingest raw rows into a clean internal model:

```
Transaction {
  id              // stable hash of (row index + timestamp + amount)
  timestamp       // parsed Date (IST)
  amount          // number | null
  method          // PaymentMethod
  category        // Category (raw)
  remarks         // string
  // Derived:
  kind            // 'spend' | 'card_payment' | 'credit_given' | 'credit_repaid_to_me' | 'emi' | 'unknown'
  cardAffected    // which card balance this row debits or credits
  tags            // parsed from remarks: trip name, person name, EMI n/m, "Cirqle", etc.
  cycleId         // statement cycle this falls into (per card)
  verified        // reconciliation flag (default false; user toggles in app)
}
```

**Row classification rules (critical — this is the heart of the system):**

1. `category ∈ {Family, Food, Fuel, Personal, Gifts/Donations, Maintenance, Entertainment, Surcharge, Taxes}` → `kind = spend`.
   - If `method` is a credit card → increases that card's **live (unbilled) debt**.
   - If `method ∈ {Fi, Cash}` → direct cash/bank spend (no card debt).
2. `category = 'Credit Given'` → money lent to someone (person name in remarks).
   - Still a real outflow AND, if paid via a card, still card debt — but must be **excludable**
     from "my own spending" views (the sheet computes both `Total Debt` and
     `Total Debt (Excl. Credit)`).
3. `category = <card name>` → `kind = card_payment`: a payment/credit applied **to** that card
   (reduces that card's outstanding). `method` tells where the money came from (usually `Fi`,
   sometimes `Perks` = reward points, or another card).
4. Remarks containing `EMI`, `n/24`, `n/12` etc. → also tag as `emi` with installment index
   (e.g. `Sheya's 18/24 Emi`, `Ipad Mini 15/24`).
5. Remarks containing `cleared` / `repayment` on Credit-Given parties → repayment events
   for the Credit Given ledger.

### 2.3 Remarks conventions to parse (best-effort tagging, never blocking)

- `(Trip <name>)` e.g. `(Trip Ponnani to Ernakulam)` → trip grouping.
- `(Cirqle)` → freelance-business related.
- `<Name> n/24` → EMI item + installment counter.
- Person names on Credit Given rows → debtor ledger key.
- `Charge` / `Surcharge` / `Tax` suffixes on EMI rows → fee components.

---

## 3. Features (everything "Financial Summary" does, rebuilt)

### 3.1 Card Settings (config, replaces `Card_Settings` tab)

CRUD UI for each credit card:

```
Card {
  name            // Edge, One Card, ICICI, Coral, Scapia, Super Money
  billDate        // statement generation day-of-month (e.g. Edge → 6th, One Card → 22nd,
                  // ICICI → 5th, Coral → 25th, Scapia → 14th, Super Money → 1st)
  graceDays       // days from statement to due date (derive: Edge 15, ICICI 18, Coral 17,
                  // Scapia 19, One Card 16, Super Money 14 — confirm with user, make editable)
  creditLimit     // needed for Utilization % (NOT visible in fetched data — ask user per card)
  color/icon      // UI
  active          // bool
}
```

Statement cycle derivation per card:
- `statementEnd(month)` = billDate of that month
- `cycleStart` = previous statementEnd + 1 day
- `dueDate` = statementEnd + graceDays
- A transaction on card X belongs to the cycle where `cycleStart ≤ txDate ≤ statementEnd`.
- Transactions after the latest statementEnd = **Unbilled (live)**.

### 3.2 Statement View (the master dashboard — replaces `Statement_View`)

A table with one row per active card. Columns (all verified against the sheet's live numbers):

| Column | Formula / Logic |
|---|---|
| Card Name | — |
| Statement Ends | latest statementEnd, displayed like `06, June 26 at Sat` |
| Due Date | displayed like `21, June 26 at Sun` |
| Days Left | `dueDate − today` in days, e.g. `11 Days` |
| Remaining Due (Bill) | billed statement amount − payments applied to that bill |
| Total Debt (Live) | Remaining Due (Bill) + Unbilled spends − unapplied credits. Can be **negative** (overpaid, e.g. One Card −189.79) |
| Utilization % | `TotalDebtLive / creditLimit` |
| Visual | progress bar of Utilization % (color-graded) |
| Status | `✅ Paid` if Remaining Due ≤ 0; `Safe` if due covered / far; `⚠ Due Soon` if Days Left ≤ threshold (configurable, suggest 5); `🔴 Overdue` if past due with balance |
| Unbilled | sum of current-cycle (post-statement) card spends − credits |
| Rem Due (Excl. Credit) | Remaining Due minus the portion whose category = Credit Given |
| Total Debt (Excl. Credit) | same exclusion applied to live debt |

**Header KPIs (verified arithmetic from the sheet):**
- `Σ Remaining Due (Bill)` — e.g. 884 + 2,020.19 = **2,904.19** ✓
- `Σ Total Debt (Live)` — e.g. **34,367.63** ✓
- `Σ Unbilled` — −189.79 + 24,102.92 + 7,550.31 = **31,463.44** ✓
- `Σ Rem Due (Excl. Credit)` — 869 + 1,335.19 = **2,204.19** ✓
- `Σ Total Debt (Excl. Credit)` — **20,466.40** ✓
- Aggregate utilization % (sum debt / sum limits)

### 3.3 Per-Card Statement Panels (replaces the per-card blocks)

For each card, a detail page with:

- **Header:** Card Name, Bill Date, Statement Month, Cycle Start, Due Date, Total Due Amount.
- **Verified / Unverified split:** every transaction has a `verified` toggle
  (= "I matched this against the bank statement"). Panel shows `Verified: ₹X | Unverified: ₹Y`.
  This reconciliation state lives in the app DB (it is NOT in Daily Spent).
- **Two ledger views (toggle):**
  1. **Live/Unbilled view** — `DATE | DESCRIPTION | DEBIT | CREDIT` for the current open cycle.
     Empty state: `✅ Bill Cleared. No new spends yet.`
  2. **Bill view** — transactions of the last generated statement:
     `DATE | DESCRIPTION | CATEGORY | DEBIT | CREDIT`, header shows `To Pay: ₹X`.
- **Cycle math block** (as seen on the Coral panel):
  `Opening Balance + Current Cycle Spends − Current Cycle Repayments = Total Due (Closing Balance)`
  (e.g. 1,506.52 + 2,648.48 − 4,136.03 = 18.97 ✓)
- **Sort controls:** by Debit/Credit/Date, Asc/Desc.
- **Activity timeline:** chronological feed mixing `➕ Billed Expense` and `➖ Recent Payment`
  events with dates and amounts.

### 3.4 Monthly Analytics (replaces `Dashboard`, `Summery of Income & Expense`, `Detailed Expenses`, `Frequency`, `Spents Frequency`)

- **Top Categories (This Month):** category → ₹ total, ranked (e.g. Personal 21,227.13;
  Surcharge 1,747.26; Fuel 456.98; Taxes 314.51; Food 300.00).
- **Current Credit Card Debt:** per-card debt list + total (mirrors 3.2 but as a card/chart).
- Month selector (the sheet's `DateSelection` tab); income vs expense summary; daily/weekly
  spend frequency charts; payment-method split; trip-tagged spend rollups.
- Calendar heatmap of daily spend (nice-to-have).

### 3.5 Forecasting (verified logic)

- **Estimated Spend Remaining This Month**:
  `avgDailySpend(currentMonthToDate, excluding card payments & credit-given?) × daysRemaining`.
  Sheet shows: period `11-May → 31-May`, Days Remaining 20, forecast ₹10,609.83,
  broken down **by card** (Scapia 6,714.96; Coral 2,636.68; ICICI 649.19; Edge 609; others 0)
  and **by category** (Personal 5,728.54; Fuel 2,094.96; Family 1,245; Food 864; Surcharge 319.77;
  Maintenance 150; Entertainment 150; Taxes 57.56).
  Implementation: compute the per-card and per-category daily run-rate over the elapsed window,
  project over remaining days; include **known recurring items** (EMIs, e.g. monthly Sheya EMI
  ~₹2,92x and Minoxidil ₹649.19 — detect recurrences from history) so the forecast isn't pure
  averaging. Make the method configurable (run-rate vs run-rate + recurrences).
- **Recommended Bank Reserve** (verified):
  `Total Debt (Live) + Estimated Spend Remaining This Month`
  = 34,367.63 + 10,609.83 = **44,977.46** ✓
  Display prominently: "Keep at least ₹X in the bank to cover all card dues + projected spend."

### 3.6 Credit Given ledger (replaces `Credit (Given)` + `Credits Raw Data`)

- Auto-built from `category = Credit Given` rows; debtor = parsed name from remarks
  (Fayiz, Ashiq sudu, Faris, Irshad, Arshadali, Jinan, Kunjimmu Thatha, Sia, Bebi's umma, …).
- Repayments detected from remarks (`… payment cleared`, `repayment`) or marked manually in-app.
- Per-person ledger: total given, total repaid, outstanding, history.
- Global: **Total outstanding credit given** — this is exactly what the sheet subtracts to get the
  "Excl. Credit" columns.

### 3.7 Credit Taken & EMI tracker (replaces `Credit (Taken)` + `EMI` tabs)

- EMI items parsed from remarks (`Sheya n/24`, `Ipad Mini n/24` + Charge + Tax rows).
- Per EMI: principal item, installment amount, paid n of m, remaining count, next due month,
  card it bills to, surcharge/tax components.
- Manual entries for any credit taken that isn't in the transaction stream.

### 3.8 Savings & Investment (replaces `Savings`, `Investment`)

- Simple manual ledgers (these tabs' data wasn't visible remotely): account/instrument name,
  contributions, current value, notes. Build as basic CRUD with totals; refine once Farooq
  shares the actual tab contents.

### 3.9 Freelance / Cirqle module (replaces `Freelance`, `Fruitful Invoice Tracker`, `Client Wise`, `Email`)

- Invoice tracker: client, invoice no, amount, issue date, due date, status (draft/sent/paid).
- Client-wise revenue rollup.
- Link `(Cirqle)`-tagged transactions from Daily Spent as business expenses/recoverables.
- (Tab contents weren't visible remotely — build the skeleton above and refine with Farooq.)

### 3.10 Event Record (replaces `EventRecord`)

- Append-only audit log of app actions: payments marked, verifications, settings changes,
  sync runs.

---

## 4. Architecture & Stack (recommended)

- **Frontend:** Next.js (React) + Tailwind. Mobile-first — entries are reviewed on the go.
  Dark/light themes. Charts: Recharts.
- **Backend/DB:** Next.js API routes (or a small Node/Express server) + **SQLite** (file DB,
  simple for a personal app) via Prisma or Drizzle. Tables: `transactions_raw` (mirror of sheet),
  `transactions` (normalized), `cards`, `cycles`, `verifications`, `credit_parties`, `emis`,
  `savings`, `investments`, `invoices`, `clients`, `events`, `settings`.
- **Sheet sync (the database stays Google Sheets):**
  - Preferred: **Google Sheets API v4** read-only on `Form Responses 1` with a service account
    (sheet is link-editable, so API key access to public sheets also works:
    `GET spreadsheets/{id}/values/Form Responses 1`).
  - Fallback (zero-auth): CSV export endpoint
    `https://docs.google.com/spreadsheets/d/1orMNGjhPKlKPTIQDKFcxd48Fip9K5Wuf5FdLkFWyimc/gviz/tq?tqx=out:csv&sheet=Form%20Responses%201`.
  - Sync strategy: poll every N minutes + manual "Sync now" button. Idempotent upsert by row
    hash; never mutate the sheet. App-side annotations (verified flags, debtor matching,
    category corrections) are stored locally keyed to transaction id, surviving re-syncs.
- **Timestamp parser:** handle `DD, Month YY at HH:MM:SS:cc AM/PM` (note the centisecond
  segment and 2-digit year = 20YY) and the `12:00:00:00 AM` date-only convention.

---

## 5. Build Order (suggested milestones)

1. Sheet sync + parser + normalized transaction store (with unit tests on the weird timestamp
   format, blank amounts, card-payment classification).
2. Card Settings + cycle engine (statement assignment, billed/unbilled split).
3. Statement View dashboard with all KPIs of §3.2.
4. Per-card panels + verification workflow (§3.3).
5. Monthly analytics + category charts (§3.4).
6. Forecast + Recommended Bank Reserve (§3.5).
7. Credit Given / Credit Taken / EMI ledgers (§3.6–3.7).
8. Savings, Investment, Freelance modules (§3.8–3.9).
9. Event log, polish, mobile UX, export (CSV/PDF of any view).

---

## 6. Open Questions (ask Farooq before/while building)

1. **Credit limits per card** — required for Utilization %. (Sheet shows odd values like
   `0.00022%` for Coral/Super Money "Total Credit Utilization", likely a formula quirk —
   recompute properly in the app.)
2. Exact **grace days / due-date rule** per card (derived values in §3.1 need confirmation;
   some sheet due dates show next-year dates like `7/8/2027` — likely formula artifacts).
3. Forecast method preference: pure run-rate, or run-rate + detected recurring items (EMIs)?
4. Contents of `Savings`, `Investment`, `Freelance`, `Fruitful Invoice Tracker`, `Client Wise`,
   `Credit (Taken)`, `Dashboard`, `Formula` tabs — **export the Financial Summary workbook as
   .xlsx and drop it in the project folder** so the exact formulas and hidden tabs can be
   audited and matched 1:1.
5. Should the app eventually offer its own quick-entry form (replacing the Google Form), writing
   back to the sheet or to its own DB?

---

## 7. Notes on fidelity

All formulas in §3 marked ✓ were **numerically verified** against live values fetched from the
Financial Summary sheet on 10-Jun-2026 (totals, unbilled sums, excl-credit sums, Coral cycle
math, and Reserve = Live Debt + Forecast). Logic not marked ✓ is reconstructed from the visible
structure and should be confirmed against the xlsx export when available.
