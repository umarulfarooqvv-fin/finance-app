import { NextResponse } from 'next/server';
import { ensureData } from '@/lib/bootstrap';
import { forecast } from '@/lib/forecast';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    await ensureData();
    const p = new URL(req.url).searchParams;
    const method = p.get('method') === 'runrate' ? 'runrate' : 'runrate+recurring';
    const excludeCreditGiven = p.get('includeCreditGiven') !== '1';
    return NextResponse.json({ ok: true, ...forecast({ method, excludeCreditGiven }) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
