import { NextResponse } from 'next/server';
import { statementView } from '@/lib/cycles';
import { ensureData } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureData();
    return NextResponse.json({ ok: true, ...statementView() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
