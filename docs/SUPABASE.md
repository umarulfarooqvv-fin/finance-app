# Supabase setup + iPhone Shortcut

The app now uses **Supabase (Postgres)** as its database instead of Google
Sheets, so loads and refreshes are near-instant, and your iPhone Shortcut posts
entries **directly** to the app (no Google Form in the middle).

---

## 1. Create the database

1. Go to [supabase.com](https://supabase.com) → **New project** (the free tier is
   plenty). Pick a region close to you (e.g. Mumbai / Singapore) for low latency.
2. When it's ready, open **SQL Editor → New query**, paste the entire contents of
   [`db/schema.sql`](../db/schema.sql), and **Run**. This creates the tables and
   the version counter.
3. Go to **Project Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret key → `SUPABASE_SERVICE_KEY` (server-only — keep it secret)

## 2. Configure the app

In `.env.local` (local) and in your Vercel project's **Environment Variables**:

```
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_KEY=eyJ...            # service_role key
INGEST_TOKEN=pick-a-long-random-string # guards the iPhone endpoint
APP_ACCESS_KEY=your-PIN                # optional, locks the web UI
```

Run locally with `npm run dev`, or deploy to Vercel (see [`DEPLOY.md`](DEPLOY.md)).

## 3. Import your existing history (one-time)

Your ~2 years of history in the Google Sheet can be imported in one call. Keep
`APPS_SCRIPT_URL` / `APPS_SCRIPT_TOKEN` in your env for this step (it reads the
full, filter-proof history via your existing Apps Script; falls back to CSV).

```bash
curl -X POST -H "x-token: YOUR_INGEST_TOKEN" "https://YOUR-APP.vercel.app/api/import"
# → { ok: true, transactions: 2100, income: 40, source: "apps-script" }
```

Re-running is safe — rows upsert by a stable id, so nothing duplicates. After
importing you can remove the `APPS_SCRIPT_*` variables.

---

## 4. Update the iPhone Shortcut (direct entry)

Your Shortcut currently ends by building a Google **Form** URL and doing *Get
contents of URL*. Change only that last part so it posts to the app instead —
the *Ask for* / *Choose from List* steps that set **Method**, **Category**,
**Remarks** and the amount stay exactly as they are.

Replace the final steps with a single **Get Contents of URL**:

- **URL:** `https://YOUR-APP.vercel.app/api/entry`
- **Method:** `POST`
- **Headers:** `x-token` = `YOUR_INGEST_TOKEN`
  (use the header, not `?token=` in the URL — query strings get written to
  Vercel's request logs, headers don't)
- **Request Body:** `Form`
- **Fields:**
  | Key | Value (Shortcut variable) |
  |---|---|
  | `amount` | your payment amount (the *Upi* / Ask-for-Number variable) |
  | `method` | `Method` |
  | `category` | `Category` |
  | `remarks` | `Remarks` |

That's it. Tapping the Shortcut now writes straight to Supabase and the entry
shows up in the app immediately — no sheet, no lag.

**Income:** to log income instead, add a field `type` = `income`, and use
`source`, `account`, `remarks`, `amount`.

### Notes

- The endpoint accepts form-encoded (what the Shortcut sends) or JSON.
- The timestamp is set server-side in IST, so you don't send one.
- The method/category lists the app understands match your Shortcut:
  methods `Fi, Jupiter, Edge, Scapia, Coral, Cash, One Card, ICICI, Perks, SBI,
  Super Money, Canara, IPPB`; categories include `Food, Personal, Credit Given,
  Family, Fuel, Groceries, Medicine, Surcharge, Taxes, Entertainment,
  Maintenance, Gifts/Donations, Credit Return, Credit Card, Savings`, and a card
  name (`Edge`, `Coral`, …) for a bill payment to that card.

## How it works

- `transactions` and `income` live in Postgres. The app loads them into a small
  in-process SQLite cache and runs all the statement/credit/analytics logic over
  it. A version counter (bumped by a DB trigger on every change) means the app
  only reloads when something actually changed — so most requests do zero work.
- Card settings, budgets, recurring definitions, holdings and invoices are stored
  as JSON in the `app_config` table.
