import { NextResponse } from 'next/server';
import { ensureData } from '@/lib/bootstrap';
import { netWorth } from '@/lib/networth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureData();
    return NextResponse.json({ ok: true, ...netWorth() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
