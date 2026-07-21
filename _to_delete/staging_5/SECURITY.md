# Security

This is a personal application that reads and writes a private Google Sheet
containing financial data. A few practices keep it safe.

## Secrets

All secrets live in `.env.local`, which is gitignored and must **never** be
committed. The template `.env.example` holds placeholders only.

| Variable | What it is |
|---|---|
| `APPS_SCRIPT_URL` | The deployed Apps Script `/exec` write-proxy URL |
| `APPS_SCRIPT_TOKEN` | Shared secret guarding every write to the sheet |
| `APP_ACCESS_KEY` | PIN that locks a public (Vercel) deployment |
| `CRON_SECRET` | Guards the `/api/alerts` cron endpoint |
| `NTFY_TOPIC` | Push-notification topic (treat as semi-secret) |

## Token rotation

The Apps Script token is the one credential that, combined with the `/exec`
URL, allows writing to your sheet. Rotate it periodically and any time it may
have been exposed:

1. In the Apps Script editor (`apps-script/Code.gs`), change the `TOKEN`
   constant to a new long random string.
2. **Deploy → Manage deployments → edit → New version** so the `/exec` URL
   stays the same.
3. Update `APPS_SCRIPT_TOKEN` in `.env.local` (local) and in the Vercel project
   environment variables (production) to match.
4. Restart `npm run dev` locally and redeploy on Vercel.

## Reporting

This is a single-owner project; report concerns directly to the owner.
