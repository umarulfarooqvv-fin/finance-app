import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { parseSpokenEntry } from '@/lib/ai/parse-entry';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/* Parses a spoken phrase into a transaction DRAFT. It writes nothing — the
   draft goes back to the form for the user to confirm. Still session-guarded,
   because it spends money on an API call and reflects the user's own data
   vocabulary back to whoever asks. */

export async function POST(req: Request): Promise<Response> {
  const auth = await requireSession();
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { transcript?: unknown };
  const transcript = typeof body.transcript === 'string' ? body.transcript : '';

  const result = await parseSpokenEntry(transcript);
  return NextResponse.json(result);
}
