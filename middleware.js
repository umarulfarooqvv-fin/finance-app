import { NextResponse } from 'next/server';

// PIN lock for public deployments. Set APP_ACCESS_KEY (your PIN) in the
// environment; visitors get a PIN screen (/lock). A year-long cookie keeps
// signed-in devices in. Without APP_ACCESS_KEY (local dev) there's no lock.
// /api/alerts is exempt so the Vercel cron can reach it (it has its own
// CRON_SECRET check and never returns financial data).

const PUBLIC_PATHS = ['/lock', '/api/lock', '/api/alerts'];

export function middleware(req) {
  const key = process.env.APP_ACCESS_KEY;
  if (!key) return NextResponse.next();

  const url = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => url.pathname.startsWith(p))) return NextResponse.next();

  // Legacy ?key= entry still works
  if (url.searchParams.get('key') === key) {
    const res = NextResponse.redirect(new URL(url.pathname, url.origin));
    setAuthCookie(res, key);
    return res;
  }
  if (req.cookies.get('app_key')?.value === key) return NextResponse.next();

  if (url.pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'Locked' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/lock', url.origin));
}

function setAuthCookie(res, key) {
  res.cookies.set('app_key', key, {
    httpOnly: true, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 365, path: '/',
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon-|apple-touch-icon).*)'],
};
