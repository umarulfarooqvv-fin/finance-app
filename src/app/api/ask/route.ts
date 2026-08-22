import { NextResponse } from 'next/server';
import { ask, type Turn } from '@/lib/ai/ask';
import { getSnapshot } from '@/lib/snapshot';
import { dayOf } from '@/lib/time';

export const dynamic = 'force-dynamic';
// Tool loops take several round trips; the default Vercel ceiling is too tight.
export const maxDuration = 60;

const MAX_QUESTION = 2000;
const MAX_HISTORY = 12;

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      question?: unknown;
      history?: unknown;
    };

    const question = String(body.question ?? '').trim();
    if (!question) {
      return NextResponse.json({ ok: false, error: 'Ask a question first.' }, { status: 400 });
    }
    if (question.length > MAX_QUESTION) {
      return NextResponse.json({ ok: false, error: 'That question is too long.' }, { status: 400 });
    }

    // Only the two shapes the model expects, and only recent turns.
    const history: Turn[] = Array.isArray(body.history)
      ? (body.history as unknown[])
          .filter((t): t is Turn =>
            typeof t === 'object' && t !== null &&
            ((t as Turn).role === 'user' || (t as Turn).role === 'assistant') &&
            typeof (t as Turn).content === 'string')
          .slice(-MAX_HISTORY)
      : [];

    const snap = await getSnapshot();
    const result = await ask(question, snap, dayOf(snap.loadedAt), history);

    return NextResponse.json(result, { status: result.ok ? 200 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
