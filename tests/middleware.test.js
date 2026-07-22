import test from 'node:test';
import assert from 'node:assert/strict';
import middleware from '../middleware.js';

// The PIN lock guards a deployment holding every transaction, balance and
// card limit. The exemption list is the whole attack surface, so it is
// asserted explicitly — a path added there without its own auth is a leak.
// (Regression: /api/import was omitted, so the PIN blocked the history
// importer even when it presented a valid INGEST_TOKEN.)

const KEY = 'test-pin';
const req = (path, { cookie, search = '' } = {}) =>
  new Request(`https://app.example${path}${search}`, {
    headers: cookie ? { cookie } : {},
  });

const isContinue = (res) => res.headers.get('x-middleware-next') === '1';

test('no APP_ACCESS_KEY (local dev) → no lock at all', () => {
  delete process.env.APP_ACCESS_KEY;
  assert.ok(isContinue(middleware(req('/'))));
  assert.ok(isContinue(middleware(req('/api/networth'))));
});

test('locked: pages redirect to /lock, APIs get 401 JSON', async () => {
  process.env.APP_ACCESS_KEY = KEY;
  const page = middleware(req('/'));
  assert.equal(page.status, 307);
  assert.equal(page.headers.get('Location'), 'https://app.example/lock');

  const api = middleware(req('/api/networth'));
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { ok: false, error: 'Locked' });
});

test('exempt paths carry their own auth and must pass through', () => {
  process.env.APP_ACCESS_KEY = KEY;
  for (const p of ['/lock', '/api/lock', '/api/alerts', '/api/entry', '/api/import']) {
    assert.ok(isContinue(middleware(req(p))), `${p} should bypass the PIN`);
  }
});

test('a path merely starting with an exempt prefix is NOT exempt', () => {
  process.env.APP_ACCESS_KEY = KEY;
  // /api/entrypoints must not ride in on /api/entry's exemption.
  assert.equal(middleware(req('/api/entrypoints')).status, 401);
  assert.equal(middleware(req('/lockbox')).status, 307);
  // …but a real subpath still is.
  assert.ok(isContinue(middleware(req('/api/entry/bulk'))));
});

test('correct cookie unlocks; wrong one does not', () => {
  process.env.APP_ACCESS_KEY = KEY;
  assert.ok(isContinue(middleware(req('/', { cookie: `app_key=${KEY}` }))));
  assert.equal(middleware(req('/', { cookie: 'app_key=nope' })).status, 307);
});

test('?key= entry sets the cookie and strips the key from the URL', () => {
  process.env.APP_ACCESS_KEY = KEY;
  const res = middleware(req('/transactions', { search: `?key=${KEY}` }));
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('Location'), 'https://app.example/transactions');
  const cookie = res.headers.get('Set-Cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
});

test('PWA and static assets stay public so the app is installable', () => {
  process.env.APP_ACCESS_KEY = KEY;
  for (const p of ['/_next/static/chunk.js', '/manifest.webmanifest', '/sw.js', '/icon-192.png']) {
    assert.ok(isContinue(middleware(req(p))), `${p} should be public`);
  }
});
