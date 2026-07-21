import { NextResponse } from 'next/server';
import { ensureData } from '@/lib/bootstrap';
import { emiItems } from '@/lib/emi';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureData();
    return NextResponse.json({ ok: true, ...emiItems() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
