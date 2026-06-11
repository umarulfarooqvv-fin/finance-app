import { NextResponse } from 'next/server';
import { syncFromSheet, getLastSync } from '@/lib/sync';
import { writesEnabled } from '@/lib/sheets';
import { hydrateMeta } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await syncFromSheet();
    let metaPulled = 0;
    if (writesEnabled()) {
      metaPulled = await hydrateMeta().catch(() => 0); // best-effort
    }
    return NextResponse.json({ ok: true, ...result, metaPulled, lastSync: getLastSync() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, lastSync: getLastSync(), writesEnabled: writesEnabled() });
}
