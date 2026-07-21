import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureData } from '@/lib/bootstrap';
import { displayCategory } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

// Aggregates for the Charts page. ?months=N (default 6) limits the trend window.
export async function GET(req) {
  try {
    await ensureData();
    const p = new URL(req.url).searchParams;
    const months = p.get('months') === 'all'
      ? 240 // lifetime
      : Math.min(24, Math.max(1, parseInt(p.get('months') || '6', 10)));
    const db = getDb();

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const nowIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:59:59`;
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const startIso = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01T00:00:00`;
    const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

    const txs = db.prepare(`
      SELECT ts, amount, method, category, remarks, kind FROM transactions
      WHERE deleted=0 AND amount IS NOT NULL AND ts>=? AND ts<=?
    `).all(startIso, nowIso);

    // Spend = everything except card payments (those are transfers, not spend)
    const spends = txs.filter((t) => !['card_payment','investment'].includes(t.kind));
    const CARDS = ['Edge', 'One Card', 'ICICI', 'Coral', 'Scapia', 'Super Money'];

    const agg = (rows, keyFn) => {
      const m = new Map();
      for (const r of rows) {
        const k = keyFn(r);
        if (!k) continue;
        m.set(k, (m.get(k) || 0) + r.amount);
      }
      return [...m.entries()].map(([name, total]) => ({ name, total: r2(total) }))
        .sort((a, b) => b.total - a.total);
    };

    const thisMonthSpends = spends.filter((t) => t.ts.startsWith(thisMonth));

    // Monthly trend by category (stacked / per-category lines)
    const trendMap = new Map();
    for (const t of spends) {
      const month = t.ts.slice(0, 7);
      if (!trendMap.has(month)) trendMap.set(month, { month });
      const e = trendMap.get(month);
      const c = displayCategory(t);
      e[c] = r2((e[c] || 0) + t.amount);
    }
    const trend = [...trendMap.values()].sort((a, b) => a.month.localeCompare(b.month));
    const trendCategories = agg(spends, (t) => displayCategory(t)).map((x) => x.name);

    // Income vs expense per month
    const incomeRows = db.prepare(`
      SELECT ts, amount FROM income
      WHERE deleted=0 AND amount IS NOT NULL AND ts>=? AND ts<=?
    `).all(startIso, nowIso);
    const ivsMap = new Map();
    for (const t of spends) {
      const m = t.ts.slice(0, 7);
      if (!ivsMap.has(m)) ivsMap.set(m, { month: m, income: 0, expense: 0 });
      ivsMap.get(m).expense = r2(ivsMap.get(m).expense + t.amount);
    }
    for (const t of incomeRows) {
      const m = t.ts.slice(0, 7);
      if (!ivsMap.has(m)) ivsMap.set(m, { month: m, income: 0, expense: 0 });
      ivsMap.get(m).income = r2(ivsMap.get(m).income + t.amount);
    }
    const incomeVsExpense = [...ivsMap.values()].sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({
      ok: true,
      months,
      window: { from: startIso.slice(0, 10), to: nowIso.slice(0, 10) },
      byCategoryThisMonth: agg(thisMonthSpends, (t) => displayCategory(t)),
      byCategory: agg(spends, (t) => displayCategory(t)),
      byCard: agg(spends.filter((t) => CARDS.includes(t.method)), (t) => t.method),
      byAccount: agg(spends.filter((t) => !CARDS.includes(t.method) && t.method !== 'Perks'), (t) => t.method),
      trend, trendCategories,
      incomeVsExpense,
      incomeBySource: agg(incomeRows.length ? db.prepare(`
        SELECT source AS name_, amount FROM income WHERE deleted=0 AND amount IS NOT NULL AND ts>=? AND ts<=?
      `).all(startIso, nowIso).map((r) => ({ ...r, amount: r.amount })) : [], (r) => r.name_),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

function r2(n) { return Math.round(n * 100) / 100; }
