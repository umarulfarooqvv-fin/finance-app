import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import proxy, { config } from '../src/proxy.ts';

/* The PIN lock is the only gate in front of the whole app, and this file has
   broken two deploys. These tests cover both the behaviour and the two
   structural rules that caused those failures. (Next 16 file convention:
   `proxy.ts`; `middleware.ts` is deprecated.) */

const PIN = 'test-pin-1234';

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://example.com${path}`, { headers });
}

const passedThrough = (res: Response) => res.headers.get('x-middleware-next') === '1';

test('with no PIN configured the app is wide open', async () => {
  delete process.env['APP_ACCESS_KEY'];
  assert.ok(passedThrough(await proxy(req('/'))));
});

test('a visitor with no cookie is sent to the lock screen', async () => {
  process.env['APP_ACCESS_KEY'] = PIN;
  const res = await proxy(req('/'));
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('Location'), 'https://example.com/lock');
});

test('the lock screen itself is reachable, or nobody could ever unlock', async () => {
  process.env['APP_ACCESS_KEY'] = PIN;
  assert.ok(passedThrough(await proxy(req('/lock'))));
  assert.ok(passedThrough(await proxy(req('/api/lock'))));
});

test('endpoints with their own auth stay exempt', async () => {
  process.env['APP_ACCESS_KEY'] = PIN;
  // Each of these authenticates itself: INGEST_TOKEN or CRON_SECRET.
  for (const path of ['/api/entry', '/api/import', '/api/alerts']) {
    assert.ok(passedThrough(await proxy(req(path))), `${path} should be exempt`);
  }
});

test('a locked API call gets 401 JSON, not a redirect a Shortcut cannot follow', async () => {
  process.env['APP_ACCESS_KEY'] = PIN;
  const res = await proxy(req('/api/forecast'));
  assert.equal(res.status, 401);
  assert.match(res.headers.get('content-type') ?? '', /json/);
});

test('the ?key= form authenticates and immediately redirects it out of the URL', async () => {
  process.env['APP_ACCESS_KEY'] = PIN;
  const res = await proxy(req(`/cards?key=${PIN}`));
  assert.equal(res.status, 307);
  // Redirects to the clean path, so the secret does not stay in the address
  // bar or in the request log of every subsequent navigation.
  assert.equal(res.headers.get('Location'), 'https://example.com/cards');
  assert.match(res.headers.get('Set-Cookie') ?? '', /app_session=/);
});

test('the session cookie does NOT contain the PIN itself', async () => {
  process.env['APP_ACCESS_KEY'] = PIN;
  const res = await proxy(req(`/?key=${PIN}`));
  const cookie = res.headers.get('Set-Cookie') ?? '';
  assert.ok(!cookie.includes(PIN), 'the raw PIN must never travel in a cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test('a valid session cookie is accepted and a wrong one is not', async () => {
  process.env['APP_ACCESS_KEY'] = PIN;
  const issued = await proxy(req(`/?key=${PIN}`));
  const token = (issued.headers.get('Set-Cookie') ?? '').match(/app_session=([a-f0-9]+)/)?.[1];
  assert.ok(token, 'a token should have been issued');

  assert.ok(passedThrough(await proxy(req('/', { cookie: `app_session=${token}` }))));
  assert.equal((await proxy(req('/', { cookie: 'app_session=deadbeef' }))).status, 307);
});

test('static and PWA assets stay public', async () => {
  process.env['APP_ACCESS_KEY'] = PIN;
  for (const path of ['/_next/static/chunk.js', '/favicon.ico', '/manifest.webmanifest', '/sw.js', '/icon-192.png']) {
    assert.ok(passedThrough(await proxy(req(path))), `${path} should be public`);
  }
});

test('STRUCTURAL: the file imports nothing and declares no runtime', () => {
  // Both rules come from real deploy failures. Importing next/server broke
  // both runtimes; declaring runtime:'nodejs' fails the build on Next 15
  // without the experimental flag.
  const raw = readFileSync(fileURLToPath(new URL('../src/proxy.ts', import.meta.url)), 'utf8');
  // The header comment names both banned constructs in order to explain them,
  // so the check has to look at code only.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const imports = src.match(/^\s*import\s.+$/gm) ?? [];
  assert.deepEqual(imports, [], `proxy must import nothing, found: ${imports.join(', ')}`);
  // Next 16 throws if a Proxy file sets `runtime` at all — it always runs on
  // Node now. The v15 rule was narrower (no 'nodejs'); this is the stricter
  // successor, so the assertion widened with the framework.
  assert.ok(!/^\s*runtime\s*:/m.test(src), 'a Proxy file must not declare a runtime');
  assert.ok(config.matcher.length > 0, 'a matcher is required');
});
