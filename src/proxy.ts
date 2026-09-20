/* ===========================================================================
   PIN lock for public deployments.  (Next 16 "proxy" file convention — the
   `middleware` filename is deprecated as of v16.0.0.)

   Set APP_ACCESS_KEY in the environment and visitors get a PIN screen. Without
   it (local dev) there is no lock at all.

   TWO RULES THIS FILE MUST KEEP, both learned from real deploy failures:

     1. Import NOTHING. Importing `next/server` broke both runtimes here — Edge
        crashed on __dirname, Node could not resolve the module. Everything
        below is pure Web API: Request, Response, URL, crypto.subtle.
     2. Do NOT declare `runtime` at all. On Next 15 this file had to avoid
        `runtime: 'nodejs'` because Node middleware was experimental and the
        deploy failed. On Next 16 Proxy defaults to the Node.js runtime and
        setting the option *throws* — so the rule survives the upgrade with a
        different reason behind it, and is now enforced by the framework too.

   Change from v2: the cookie used to hold the PIN itself, so the shared secret
   travelled on every single request. It now holds a SHA-256 derivation of it
   instead. Same user experience, and the raw PIN never leaves the server.
   =========================================================================== */

/** Endpoints exempt from the PIN because each carries its OWN authentication.

    /api/entry and /api/import check INGEST_TOKEN. /api/cron/reminders checks
    CRON_SECRET, and /api/calendar checks CALENDAR_TOKEN — both must be out
    here because neither caller can hold a PIN cookie: Vercel Cron sends a
    bearer header and nothing else, and iOS Calendar refetches the feed on its
    own schedule with no session at all. Behind the PIN they answered 401 to
    the only two clients they exist for.

    Both refuse EVERYONE when their secret is unset, which is what makes them
    safe to exempt: the failure mode is a silent feed, never an open one.

    Anything added here MUST authenticate itself — the PIN is the only other
    gate in front of the whole app. /api/push/subscribe is deliberately NOT
    here: it is called from the app with a session, and a device-registration
    endpoint reachable without one would let a stranger attach their phone to
    these reminders.

    /api/alerts was v2's ntfy endpoint and no longer exists; its exemption is
    removed rather than left as a hole pointing at nothing. */
const PUBLIC_PATHS = [
  '/lock', '/api/lock', '/api/entry', '/api/import',
  '/api/calendar', '/api/cron',
];

/** Exempt at EXACTLY this path, and not below it.

    /api/capture takes a photo from the Shortcut and checks INGEST_TOKEN, so it
    belongs outside the PIN. /api/capture/<id> SERVES a photo back and is
    guarded by the session instead — putting it in PUBLIC_PATHS would exempt
    both, because that list matches children too. It would still be safe, since
    the route checks the session itself, but relying on that is one refactor
    away from an open image endpoint. */
const PUBLIC_EXACT = ['/api/capture'];

const COOKIE = 'app_session';
const YEAR = 60 * 60 * 24 * 365;

/** The wire protocol behind NextResponse.next(). */
const CONTINUE = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

function redirect(location: string, cookie?: string): Response {
  const headers: Record<string, string> = { Location: location };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 307, headers });
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
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

/** Derive the session value from the PIN. Not a password hash — it exists so
    the cookie is not itself the secret, and it must stay dependency-free. */
async function sessionToken(key: string): Promise<string> {
  const data = new TextEncoder().encode(`pfm-v3:${key}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent comparison, to avoid leaking the token by timing. */
function sameToken(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function proxy(req: Request): Promise<Response> {
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

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return CONTINUE();
  if (PUBLIC_EXACT.includes(pathname)) return CONTINUE();

  const token = await sessionToken(key);
  const cookie =
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Secure; Max-Age=${YEAR}; Path=/`;

  // Legacy ?key= entry still works, and immediately redirects so the secret
  // does not linger in the address bar or in Vercel's request logs.
  if (url.searchParams.get('key') === key) return redirect(url.origin + pathname, cookie);
  if (sameToken(readCookie(req, COOKIE), token)) return CONTINUE();

  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ ok: false, error: 'Locked' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  return redirect(`${url.origin}/lock`);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon-|apple-touch-icon).*)',
  ],
};
