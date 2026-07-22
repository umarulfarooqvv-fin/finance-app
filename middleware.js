// PIN lock for public deployments. Set APP_ACCESS_KEY (your PIN) in the
// environment; visitors get a PIN screen (/lock). A year-long cookie keeps
// signed-in devices in. Without APP_ACCESS_KEY (local dev) there's no lock.
//
// IMPORTANT — two rules this file must keep, both learned the hard way:
//  1. Dependency-free: importing `next/server` broke both runtimes here
//     (Edge crashed on `__dirname`; Node.js could not resolve the module).
//     Everything below is pure Web API — Request/Response/URL only.
//  2. No `runtime: 'nodejs'` in the config export. Node.js middleware is
//     experimental in Next 15 and needs `experimental.nodeMiddleware`;
//     without it the deploy fails. The default Edge runtime is fine because
//     nothing here touches Node built-ins.

// Exempt from the PIN because each carries its own auth: /api/entry and
// /api/import check INGEST_TOKEN, /api/alerts checks CRON_SECRET. Anything
// added here MUST authenticate itself — the PIN is the only other gate.
const PUBLIC_PATHS = ['/lock', '/api/lock', '/api/alerts', '/api/entry', '/api/import'];

// Pass-through: the x-middleware-next header is the wire protocol behind
// NextResponse.next() / @vercel/functions next().
const CONTINUE = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

function redirect(location, cookie) {
  const headers = { Location: location };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 307, headers });
}

function getCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1));
      } catch {
        return part.slice(eq + 1);
      }
    }
  }
  return null;
}

export default function middleware(req) {
  const key = process.env.APP_ACCESS_KEY;
  if (!key) return CONTINUE();

  const url = new URL(req.url);
  const { pathname } = url;

  // Static and PWA assets stay public.
  if (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js' ||
    pathname.startsWith('/icon-') ||
    pathname.startsWith('/apple-touch-icon')
  ) {
    return CONTINUE();
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) return CONTINUE();

  const authCookie =
    `app_key=${encodeURIComponent(key)}; HttpOnly; SameSite=Lax; Secure; ` +
    `Max-Age=${60 * 60 * 24 * 365}; Path=/`;

  // Legacy ?key= entry still works.
  if (url.searchParams.get('key') === key) return redirect(url.origin + pathname, authCookie);
  if (getCookie(req, 'app_key') === key) return CONTINUE();

  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ ok: false, error: 'Locked' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  return redirect(url.origin + '/lock');
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon-|apple-touch-icon).*)',
  ],
};
