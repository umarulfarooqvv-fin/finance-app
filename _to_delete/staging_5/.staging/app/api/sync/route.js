import { NextResponse } from 'next/server';
import { loadFromStore, getLastSync } from '@/lib/sync';
import { writesEnabled } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

// "Sync now" just reloads the compute cache from Supabase (fast).
export async function POST() {
  try {
    const result = await loadFromStore();
    return NextResponse.json({ ok: true, ...result, lastSync: getLastSync() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, lastSync: getLastSync(), writesEnabled: writesEnabled() });
}
