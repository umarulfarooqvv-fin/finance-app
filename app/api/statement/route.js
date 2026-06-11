import { NextResponse } from 'next/server';
import { statementView } from '@/lib/cycles';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...statementView() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
