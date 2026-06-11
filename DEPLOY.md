# Deploying to Vercel via GitHub

The app is serverless-ready: on Vercel the SQLite cache lives in `/tmp` and
rebuilds itself from the Daily Spent sheet on every cold start. Verified flags
(AppMeta tab) and card settings (AppConfig tab) live in the sheet, so nothing
is lost between restarts. `.env.local` and `data/` are gitignored — no secrets
ever reach GitHub.

## 0. One-time: update the Apps Script

`apps-script/Code.gs` gained two actions (`setConfig`/`getConfig`) that persist
card settings in an AppConfig tab. In the Apps Script editor:

1. Paste the updated `Code.gs` over the old one (keep your TOKEN line!).
2. Deploy → **Manage deployments** → ✏️ edit → Version: **New version** → Deploy.
   (This keeps the same /exec URL.)

## 1. Push to GitHub

From the `finance-app` folder:

```bash
git init
git add -A
git commit -m "Personal Finance Manager"
```

Create an empty **private** repo on github.com (e.g. `finance-app`), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/finance-app.git
git branch -M main
git push -u origin main
```

## 2. Import in Vercel

1. vercel.com → **Add New → Project** → import the `finance-app` repo.
2. Framework preset: Next.js (auto-detected). No build settings to change.
3. **Environment Variables** — add these four (copy values from `.env.local`):

   | Name | Value |
   |---|---|
   | `DAILY_SPENT_SHEET_ID` | `1orMNGjhPKlKPTIQDKFcxd48Fip9K5Wuf5FdLkFWyimc` |
   | `APPS_SCRIPT_URL` | your `…/exec` URL |
   | `APPS_SCRIPT_TOKEN` | your token |
   | `APP_ACCESS_KEY` | **a new random string — this locks the app** |

   (`DAILY_SPENT_TAB` defaults to `Form Responses 1`; add it only if yours differs.)

4. Deploy.

## 3. First open

Visit `https://your-app.vercel.app/?key=YOUR_APP_ACCESS_KEY` once — a cookie
keeps you signed in for a year on that device. Without the key the app returns
401 Locked. Do this on your phone too.

## Notes

- First request after idle (~cold start) takes a couple of seconds — it's
  re-syncing the sheet. Subsequent requests are fast.
- The Event log (audit trail) is ephemeral on Vercel; everything else persists
  via the sheet.
- Every `git push` to `main` auto-deploys.
- Local dev keeps working exactly as before (`npm run dev`).
