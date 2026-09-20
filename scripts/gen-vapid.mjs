#!/usr/bin/env node
/* Generate the secrets the reminder feature needs.
 *
 * The PUBLIC VAPID key is handed to the browser to subscribe with; the PRIVATE
 * one signs, never leaves the server, and is what an attacker would need to
 * push to the phone. Regenerating the pair invalidates every existing
 * subscription, which is also how a lost device is revoked.
 *
 *   npm run gen:vapid                     print them
 *   npm run gen:vapid -- --write          append them to .env.local
 *   npm run gen:vapid -- --write --subject mailto:me@example.com
 *
 * --write exists so the values can go from generator to file without passing
 * through a terminal, a clipboard or a chat window on the way.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';

const args = process.argv.slice(2);
const write = args.includes('--write');
const subject = args[args.indexOf('--subject') + 1];
const SUBJECT = args.includes('--subject') && subject ? subject : 'mailto:you@example.com';

if (!/^(mailto:|https:\/\/)/.test(SUBJECT)) {
  console.error('--subject must be a mailto: or https: URL. Push services reject anything else.');
  process.exit(1);
}

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
const secret = () => randomUUID().replace(/-/g, '');

const block = `
# --- Reminders (generated ${new Date().toISOString().slice(0, 10)}) ---
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=${SUBJECT}
CRON_SECRET=${secret()}
CALENDAR_TOKEN=${secret()}
`;

if (!write) {
  console.log(`\nAdd these to .env.local and to the Vercel project's environment variables.\n${block}
Or let the script do it, so the values never touch a clipboard:

  npm run gen:vapid -- --write --subject mailto:you@example.com
`);
  process.exit(0);
}

const FILE = '.env.local';
let existing = '';
try {
  existing = readFileSync(FILE, 'utf8');
} catch {
  // A missing .env.local is fine — appending creates it.
}

/* Never append a second copy of a key that is already set. Two values for one
   name is a file where the effective secret depends on parse order, and the
   push that stops working is blamed on everything else first. */
const clash = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'CRON_SECRET', 'CALENDAR_TOKEN']
  .filter((k) => new RegExp(`^${k}=`, 'm').test(existing));

if (clash.length > 0) {
  console.error(`
${FILE} already sets ${clash.join(', ')}.

Nothing was written. Remove those lines first if you mean to replace them —
and note that replacing VAPID keys unsubscribes every device.
`);
  process.exit(1);
}

appendFileSync(FILE, block);

console.log(`
Written to ${FILE}. The values were not printed.

Next:
  1. Restart the dev server so it reads them.
  2. Copy the same five values into the Vercel project's environment variables
     (Settings -> Environment Variables) or reminders will work only locally.
     Read them with:  grep -E '^(VAPID|CRON_SECRET|CALENDAR_TOKEN)' ${FILE}
${SUBJECT === 'mailto:you@example.com' ? `
  3. VAPID_SUBJECT is still the placeholder. Edit it to a real mailto: or
     https: URL — push services reject a made-up one, and it is how they
     reach you if deliveries start failing.
` : ''}`);
