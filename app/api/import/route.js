import { NextResponse } from 'next/server';
import { sheetRowsForImport } from '@/lib/sync';
import { insert } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// One-time (or occasional) import of the full Google Sheet history into Supabase.
// Protected by INGEST_TOKEN. POST ?token=... to run. Safe to re-run (upserts).
async function chunkInsert(table, rows) {
  const size = 500;
  let n = 0;
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    await insert(table, batch, { upsert: true });
    n += batch.length;
  }
  return n;
}

export async function POST(req) {
  try {
    const token = process.env.INGEST_TOKEN;
    const provided = new URL(req.url).searchParams.get('token') || req.headers.get('x-token');
    if (token && provided !== token) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { transactions, income, source } = await sheetRowsForImport();
    const tx = await chunkInsert('transactions', transactions);
    const inc = income.length ? await chunkInsert('income', income) : 0;
    return NextResponse.json({ ok: true, source, transactions: tx, income: inc });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
