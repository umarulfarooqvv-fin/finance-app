import { NextResponse } from 'next/server';
import { ensureData } from '@/lib/bootstrap';
import { searchAll } from '@/lib/search';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    await ensureData();
    const q = new URL(req.url).searchParams.get('q') || '';
    return NextResponse.json({ ok: true, ...searchAll(q) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
