import { NextResponse } from 'next/server';
import { ensureData } from '@/lib/bootstrap';
import { insightsOverview } from '@/lib/insights';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureData();
    return NextResponse.json({ ok: true, ...insightsOverview() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
