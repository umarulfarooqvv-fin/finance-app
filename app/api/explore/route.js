import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureData } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

// Keyword analytics over the whole history (lifetime by default).
// ?q=barber — matches remarks, category, or method (case-insensitive)
// ?category= / ?method= — optional exact filters
// ?from=YYYY-MM-DD / ?to=YYYY-MM-DD — optional range (default: lifetime)
// Card payments are excluded — they're transfers, not spending.
export async function GET(req) {
  try {
    await ensureData();
    const p = new URL(req.url).searchParams;
    const db = getDb();

    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const nowIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:59:59`;

    const where = ["deleted=0", "amount IS NOT NULL", "ts IS NOT NULL", "kind<>'card_payment'", 'ts<=?'];
    const args = [p.get('to') ? `${p.get('to')}T23:59:59` : nowIso];
    if (p.get('from')) { where.push('ts>=?'); args.push(`${p.get('from')}T00:00:00`); }
    if (p.get('q')) {
      where.push('(remarks LIKE ? COLLATE NOCASE OR category LIKE ? COLLATE NOCASE OR method LIKE ? COLLATE NOCASE)');
      const q = `%${p.get('q').trim()}%`;
      args.push(q, q, q);
    }
    if (p.get('category')) { where.push('category=?'); args.push(p.get('category')); }
    if (p.get('method')) { where.push('method=?'); args.push(p.get('method')); }

    const rows = db.prepare(`
      SELECT id, ts, amount, method, category, remarks FROM transactions
      WHERE ${where.join(' AND ')} ORDER BY ts ASC
    `).all(...args);

    // KPIs
    const total = r2(rows.reduce((a, r) => a + r.amount, 0));
    const first = rows[0]?.ts?.slice(0, 10) || null;
    const last = rows[rows.length - 1]?.ts?.slice(0, 10) || null;
    let monthsSpanned = 1;
    if (first && last) {
      const f = new Date(first), l = new Date(last);
      monthsSpanned = (l.getFullYear() - f.getFullYear()) * 12 + (l.getMonth() - f.getMonth()) + 1;
    }

    // Monthly trend + cumulative
    const mMap = new Map();
    for (const r of rows) {
      const m = r.ts.slice(0, 7);
      mMap.set(m, r2((mMap.get(m) || 0) + r.amount));
    }
    // fill gaps so the chart shows zero months
    const monthly = [];
    if (first && last) {
      const f = new Date(`${first.slice(0, 7)}-01`), l = new Date(`${last.slice(0, 7)}-01`);
      let cum = 0;
      for (let d = new Date(f); d <= l; d.setMonth(d.getMonth() + 1)) {
        const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        const v = mMap.get(key) || 0;
        cum = r2(cum + v);
        monthly.push({ month: key, total: v, cumulative: cum });
      }
    }

    // Breakdown of matches by category & method
    const agg = (keyFn) => {
      const m = new Map();
      for (const r of rows) m.set(keyFn(r), r2((m.get(keyFn(r)) || 0) + r.amount));
      return [...m.entries()].map(([name, t]) => ({ name, total: t })).sort((a, b) => b.total - a.total);
    };

    return NextResponse.json({
      ok: true,
      kpis: {
        total, count: rows.length, first, last,
        monthlyAvg: r2(total / Math.max(1, monthsSpanned)),
        perTxAvg: rows.length ? r2(total / rows.length) : 0,
        monthsSpanned,
      },
      monthly,
      byCategory: agg((r) => r.category),
      byMethod: agg((r) => r.method),
      rows: rows.slice(-500).reverse().map((r) => ({ ...r, date: r.ts.slice(0, 10) })),
      truncated: rows.length > 500,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

function r2(n) { return Math.round(n * 100) / 100; }
