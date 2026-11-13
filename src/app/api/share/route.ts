import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSnapshot, invalidateSnapshot } from '@/lib/snapshot';
import { updateConfigKey } from '@/lib/config';
import { createTransaction } from '@/lib/transactions';
import { validateTransaction } from '@/lib/validation';
import { joinTags } from '@/lib/user-tags';
import { dayOf, nowIST } from '@/lib/time';
import { FAMILY_KEY, familyFrom, type FamilyConfig } from '@/lib/family';
import { SPLITS_KEY, splitsFrom, type Split } from '@/lib/splits';
import { readShare, shareMenus, type ShareBody } from '@/lib/share-intake';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Family and split payments from an iPhone Shortcut.

   GET  — the names a Shortcut's menus offer: family groups and people, the
          splits and who is in each (lib/share-intake's shareMenus).
   POST — JSON: {"to":"family","group":"Car","by":"Ikka","amount":"5000"}
                {"to":"split","split":"Wayanad trip","by":"Ashiq","amount":"600","note":"Room"}
                {"to":"split","by":"Me","method":"Fi","amount":"900","note":"Dinner"}

   A brother's or a friend's payment goes on the Family or Splits page only.
   YOUR payment is money that left your account, so it becomes an ordinary
   entry in the ledger — for a split as Credit Given (how the owner logs
   paying for the group first), picked into the split; for the family as
   Family, tagged with the group's name so the group finds it.

   Guarded by INGEST_TOKEN in the x-token header, exempt from the PIN (see
   src/proxy.ts), like /api/entry. Safe to retry: the same payment sent twice
   within a minute is one payment.
   =========================================================================== */

const unauthorised = () => NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

function allowed(req: Request): boolean {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) return process.env.NODE_ENV !== 'production';
  return req.headers.get('x-token') === expected;
}

async function readBody(req: Request): Promise<ShareBody> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, String(v ?? '')]));
  }
  const form = await req.formData().catch(() => null);
  const out: ShareBody = {};
  if (form) for (const [k, v] of form.entries()) if (typeof v === 'string') out[k] = v;
  return out;
}

/** One payment per minute per content: a retry over a bad connection lands on the same one. */
async function keyOf(parts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode([...parts, nowIST().slice(0, 16)].join('\u0000'));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function GET(req: Request): Promise<Response> {
  if (!allowed(req)) return unauthorised();
  const snap = await getSnapshot({ force: true });
  return NextResponse.json({ ok: true, ...shareMenus(snap.config) });
}

export async function POST(req: Request): Promise<Response> {
  if (!allowed(req)) return unauthorised();
  try {
    const body = await readBody(req);
    const snap = await getSnapshot({ force: true });
    const today = dayOf(nowIST());
    const intent = readShare(snap.config, body, today);
    if ('error' in intent) return NextResponse.json({ ok: false, error: intent.error }, { status: 400 });

    const key = await keyOf([intent.to, 'group' in intent ? intent.group : intent.split, 'member' in intent ? intent.member : intent.payer, String(intent.amount), intent.note]);
    const ctx = { actor: 'shortcut', via: 'ingest-token' } as const;
    const ts = intent.day === today ? nowIST() : `${intent.day}T12:00:00`;
    let message: string;

    if (intent.to === 'family') {
      if (intent.mine) {
        // Your own payment: a Family entry tagged with the group, so the group finds it.
        const method = (body['method'] ?? '').trim();
        if (!method) return NextResponse.json({ ok: false, error: 'method: what you paid with — Fi, Cash…' }, { status: 400 });
        const input = { amount: intent.amount, method, category: 'Family', remarks: joinTags(intent.note || intent.groupName, [intent.groupName]), ts };
        const errors = validateTransaction(input, today);
        if (errors) return NextResponse.json({ ok: false, error: Object.values(errors)[0] }, { status: 400 });
        await createTransaction({ ...input, clientKey: `share:${key}` }, ctx, 'shortcut');
        message = `₹${intent.amount} from ${method} added to ${intent.groupName}.`;
      } else {
        await updateConfigKey<Partial<FamilyConfig>>(FAMILY_KEY, (raw) => {
          const was = familyFrom({ [FAMILY_KEY]: raw && Object.keys(raw).length ? raw : undefined }).cfg;
          const id = `fp-${key}`;
          if (was.payments.some((p) => p.id === id)) return was;
          return { ...was, payments: [...was.payments, { id, group: intent.group, member: intent.member, amount: intent.amount, day: intent.day, ...(intent.note ? { note: intent.note } : {}) }] };
        });
        message = `₹${intent.amount} added to ${intent.groupName}.`;
      }
      revalidatePath('/family');
    } else {
      let txId: string | null = null;
      if (intent.mine) {
        // You paid for the group: money left your account, logged the way you log it — Credit Given.
        const input = { amount: intent.amount, method: intent.method, category: 'Credit Given', remarks: intent.note || intent.splitName, ts };
        const errors = validateTransaction(input, today);
        if (errors) return NextResponse.json({ ok: false, error: Object.values(errors)[0] }, { status: 400 });
        txId = (await createTransaction({ ...input, clientKey: `share:${key}` }, ctx, 'shortcut')).id;
      }
      await updateConfigKey<Split[]>(SPLITS_KEY, (raw) => splitsFrom({ [SPLITS_KEY]: raw }).map((s) => {
        if (s.id !== intent.split) return s;
        if (txId) return { ...s, include: [...new Set([...(s.include ?? []), txId])] };
        const id = `se-${key}`;
        if (s.expenses.some((e) => e.id === id)) return s;
        return { ...s, expenses: [...s.expenses, { id, payer: intent.payer, amount: intent.amount, day: intent.day, ...(intent.note ? { note: intent.note } : {}) }] };
      }));
      revalidatePath('/splits');
      message = `₹${intent.amount} added to ${intent.splitName}.`;
    }

    invalidateSnapshot();
    revalidatePath('/');
    revalidatePath('/transactions');
    return NextResponse.json({ ok: true, message });
  } catch (err) {
    console.error('[share]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'Could not save that. Try again.' }, { status: 500 });
  }
}
