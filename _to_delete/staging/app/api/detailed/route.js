import { NextResponse } from 'next/server';
import { detailedExpenses } from '@/lib/analytics';
import { ensureData } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    await ensureData();
    const p = new URL(req.url).searchParams;
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const from = p.get('from') || iso(new Date(today.getFullYear(), today.getMonth(), 1));
    const to = p.get('to') || iso(today);
    const excludeCategories = (p.get('excludeCats') || '').split(',').filter(Boolean);
    const excludeMethods = (p.get('excludeMethods') || '').split(',').filter(Boolean);
    return NextResponse.json({ ok: true, ...detailedExpenses({ from, to, excludeCategories, excludeMethods }) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
