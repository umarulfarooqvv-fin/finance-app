import { NextResponse } from 'next/server';
import { getDb, logEvent } from '@/lib/db';
import { ensureData } from '@/lib/bootstrap';
import { getBudgets, saveBudgets, budgetOverview } from '@/lib/budgets';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureData();
    return NextResponse.json({ ok: true, budgets: getBudgets(), ...budgetOverview() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await ensureData();
    const body = await req.json();
    const db = getDb();
    if (body.action === 'save') {
      const saved = await saveBudgets(body.budgets || {}, db);
      logEvent('budgets_save', { categories: Object.keys(saved).length });
      return NextResponse.json({ ok: true, budgets: saved, ...budgetOverview() });
    }
    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
