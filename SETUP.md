# Setup

## 1. Install & run the app

```bash
cd finance-app
npm install
cp .env.example .env.local
npm run dev          # → http://localhost:3000
```

The app works read-only out of the box: it pulls your Daily Spent sheet on load
and on every "Sync now" click. Verify flags work locally too. To enable
**adding and editing rows** (and saving verify flags into the sheet), do step 2.

## 2. Enable write access (one-time, ~2 minutes)

1. Open the **Daily Spent** Google Sheet.
2. Menu: **Extensions → Apps Script**.
3. Delete any placeholder code, paste the entire contents of `apps-script/Code.gs`.
4. In the pasted code, change the line
   `var TOKEN = 'change-me-to-something-random';`
   to your own random string (anything long, e.g. mash the keyboard).
5. Click **Deploy → New deployment**.
   - Gear icon → type: **Web app**
   - Description: anything
   - **Execute as: Me**
   - **Who has access: Anyone**
   - Click **Deploy**, authorize when prompted (it only touches this spreadsheet).
6. Copy the **Web app URL** (ends in `/exec`).
7. In `finance-app/.env.local`, set:

   ```
   APPS_SCRIPT_URL=https://script.google.com/macros/s/…/exec
   APPS_SCRIPT_TOKEN=the same random string you put in step 4
   ```

8. Restart `npm run dev`. The Transactions page warning disappears; Add/Edit work.

### What the script does — and doesn't

- Adds/edits rows in **columns A–E only** of `Form Responses 1`.
- Stores verified flags in a new tab called **AppMeta** (it creates it on first use).
- Never touches your Google Form, the iPhone Shortcut flow, or any other tab.
- Every request requires the secret token, so the URL alone is not enough to write.

### If you ever change the sheet

If you re-deploy the script, pick **Deploy → Manage deployments → edit → New version**
so the URL stays the same.

## 3. First-run checklist inside the app

1. **Cards page** — confirm bill dates / grace days, and enter each card's credit
   limit (needed for Utilization %).
2. **Statements page** — check the numbers against your Financial Summary sheet.
3. **Transactions page** — try the ✓ verify toggle, the filters, and (after step 2)
   the Add button.

## Daily use

- Keep entering spends however you like (iPhone Shortcut → Form, or the app's Add button).
- Open the app → it auto-syncs → reconcile with the ✓ toggles per card.
- "Sync now" in the nav pulls the latest rows any time.
