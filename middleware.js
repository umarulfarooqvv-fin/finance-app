import { NextResponse } from 'next/server';

// Simple access lock for public deployments (Vercel). Set APP_ACCESS_KEY in
// the environment; then open the app once as https://your-app/…?key=THE_KEY —
// a cookie keeps you signed in. Without APP_ACCESS_KEY set (local dev), no lock.

export function middleware(req) {
  const key = process.env.APP_ACCESS_KEY;
  if (!key) return NextResponse.next();

  const url = req.nextUrl;
  const provided = url.searchParams.get('key');
  if (provided === key) {
    const clean = new URL(url.pathname, url.origin);
    const res = NextResponse.redirect(clean);
    res.cookies.set('app_key', key, {
      httpOnly: true, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 365, path: '/',
    });
    return res;
  }
  if (req.cookies.get('app_key')?.value === key) return NextResponse.next();

  return new NextResponse(
    'Locked. Open the app with ?key=YOUR_ACCESS_KEY appended to the URL once.',
    { status: 401, headers: { 'content-type': 'text/plain' } }
  );
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
