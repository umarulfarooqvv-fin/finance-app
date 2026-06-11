import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const key = process.env.APP_ACCESS_KEY;
  if (!key) return NextResponse.json({ ok: true }); // no lock configured
  let pin = '';
  try { pin = (await req.json()).pin || ''; } catch {}
  if (pin !== key) {
    return NextResponse.json({ ok: false, error: 'Wrong PIN' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set('app_key', key, {
    httpOnly: true, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 24 * 365, path: '/',
  });
  return res;
}
