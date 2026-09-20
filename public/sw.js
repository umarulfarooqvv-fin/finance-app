// Minimal offline cache: network-first for same-origin GETs, fall back to the
// last cached response when offline. The app is read-mostly, so this makes it
// usable on the go even without a connection.
const CACHE = 'fin-cache-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.status === 200) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});

/* ---------------------------------------------------------------------------
   Push.

   The payload is built on the server and shown as it arrives — the worker does
   no arithmetic, because a notification that disagrees with the app is worse
   than no notification. A push with no readable body still shows something
   rather than nothing: iOS terminates a worker that receives a push and
   displays no notification, and repeated offences cost the subscription.
   ------------------------------------------------------------------------- */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = {};
  }

  const title = data.title || 'Finance';
  const options = {
    body: data.body || 'Something is due.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'finance-due',
    // Replace an earlier notification about the same thing rather than
    // stacking a week of them on the lock screen.
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse an open window when there is one: opening a second copy of an
    // installed web app on iOS is disorienting and loses any unsaved entry.
    for (const client of all) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
