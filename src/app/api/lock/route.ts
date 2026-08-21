import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/* Exchange the PIN for a session cookie. The derivation must match
   src/middleware.ts exactly — that file cannot import anything, so the two
   copies are kept deliberately identical rather than shared. */

const COOKIE = 'app_session';
const YEAR = 60 * 60 * 24 * 365;

async function sessionToken(key: string): Promise<string> {
  const data = new TextEncoder().encode(`pfm-v3:${key}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(req: Request): Promise<Response> {
  const key = process.env.APP_ACCESS_KEY;
  if (!key) return NextResponse.json({ ok: true, unlocked: true });

  const form = await req.formData().catch(() => null);
  const pin = String(form?.get('pin') ?? '');

  if (pin !== key) {
    // Deliberately vague, and no hint about length or format.
    return NextResponse.redirect(new URL('/lock?e=1', req.url), 303);
  }

  const res = NextResponse.redirect(new URL('/', req.url), 303);
  res.cookies.set(COOKIE, await sessionToken(key), {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: YEAR,
    path: '/',
  });
  return res;
}
