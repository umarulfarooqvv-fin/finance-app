import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { removeSubscription, saveSubscription, subscriptionId } from '@/lib/push';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Registering (and unregistering) this device for push.

   Session-guarded: a subscription endpoint is a capability to make this
   person's phone buzz, and accepting one from an unauthenticated caller would
   let anyone attach their own device to these reminders.

   The browser produced the subscription; the server only stores it. Nothing
   here decides whether push is allowed — iOS already asked, and the answer is
   the user's.
   =========================================================================== */

type Body = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
  label?: unknown;
};

export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : '';
  const authKey = typeof body.keys?.auth === 'string' ? body.keys.auth : '';

  /* Only https, and only a real URL. An endpoint is a push address the server
     will later POST to, so accepting an arbitrary string would turn this into
     a request forwarder pointed wherever the caller likes. */
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return NextResponse.json({ ok: false, error: 'That is not a push endpoint.' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:' || !p256dh || !authKey) {
    return NextResponse.json({ ok: false, error: 'That is not a push endpoint.' }, { status: 400 });
  }

  await saveSubscription({
    endpoint,
    keys: { p256dh, auth: authKey },
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 60) : 'This device',
    addedOn: new Date().toISOString().slice(0, 10),
  });

  return NextResponse.json({ ok: true, id: subscriptionId(endpoint) });
}

export async function DELETE(req: Request): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { endpoint?: unknown };
  if (typeof body.endpoint !== 'string' || !body.endpoint) {
    return NextResponse.json({ ok: false, error: 'Which device?' }, { status: 400 });
  }
  await removeSubscription(subscriptionId(body.endpoint));
  return NextResponse.json({ ok: true });
}
