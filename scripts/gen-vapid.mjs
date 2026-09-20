#!/usr/bin/env node
/* Generate the VAPID key pair that signs push notifications.
 *
 * Run once. The PUBLIC key is handed to the browser to subscribe with; the
 * PRIVATE key signs, never leaves the server, and is what an attacker would
 * need to push to the phone. Regenerating them invalidates every existing
 * subscription, which is also how you revoke a device you no longer have. */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Add these to .env.local, and to the Vercel project's environment variables.

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com

Two more secrets this feature needs, each at least 16 characters:

CRON_SECRET=${crypto.randomUUID().replace(/-/g, '')}
CALENDAR_TOKEN=${crypto.randomUUID().replace(/-/g, '')}

VAPID_SUBJECT must be a real mailto: or https: URL — push services reject a
made-up one, and it is how they reach you if your pushes start failing.
`);
