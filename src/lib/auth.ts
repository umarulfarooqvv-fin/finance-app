import 'server-only';
import { cookies } from 'next/headers';

/* ===========================================================================
   The authorization boundary.

   This app has one user, so there is no role model — but "one user" is not the
   same as "no boundary". Two rules hold regardless of how many people use it:

     1. A write must verify the session ITSELF, server-side. proxy.ts already
        gates navigation, but a Server Action is a POST that an attacker can
        aim directly at the route. Trusting the proxy to have run is the
        blueprint's L4 lesson: of its four enforcement points, only the check
        inside the write actually secures anything. The other three are UX.

     2. The check returns a context object rather than a boolean. Today that
        context carries only `actor`. When a second user or a role model
        arrives, permissions are added to this one shape and every call site
        already threads it — which is what "extensible for RBAC later" means in
        practice, without building the kernel now.

   The derivation below is duplicated verbatim in src/proxy.ts, which is not an
   oversight: that file may not import anything (see its header). A test asserts
   the two stay identical.
   =========================================================================== */

const COOKIE = 'app_session';

export async function sessionToken(key: string): Promise<string> {
  const data = new TextEncoder().encode(`pfm-v3:${key}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent comparison, so a wrong token cannot be probed by timing. */
function sameToken(a: string | null | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Who is performing this write.
 *
 * `actor` is recorded on every audited change. It is a string rather than a
 * user id precisely so that adding real users later widens this type instead
 * of introducing one.
 */
export type Actor = {
  actor: string;
  /** How the caller proved itself — useful in the audit trail. */
  via: 'session' | 'ingest-token' | 'open';
};

export type AuthResult =
  | { ok: true; ctx: Actor }
  | { ok: false; error: string };

/**
 * Verify the caller may write.
 *
 * With APP_ACCESS_KEY unset the app is unlocked by design (local development),
 * and this reports `via: 'open'` so the audit trail still records that the
 * write was unauthenticated rather than pretending it was a real session.
 */
export async function requireSession(): Promise<AuthResult> {
  const key = process.env.APP_ACCESS_KEY;
  if (!key) return { ok: true, ctx: { actor: 'local', via: 'open' } };

  const jar = await cookies();
  const presented = jar.get(COOKIE)?.value;
  const expected = await sessionToken(key);

  if (!sameToken(presented, expected)) {
    return { ok: false, error: 'Your session has expired. Unlock the app and try again.' };
  }
  return { ok: true, ctx: { actor: 'farooq', via: 'session' } };
}

/** For the Shortcut endpoint, which authenticates with INGEST_TOKEN instead. */
export function verifyIngestToken(presented: string | null): AuthResult {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) return { ok: true, ctx: { actor: 'shortcut', via: 'open' } };
  if (!presented || presented !== expected) return { ok: false, error: 'Unauthorized' };
  return { ok: true, ctx: { actor: 'shortcut', via: 'ingest-token' } };
}
