import { NextResponse } from 'next/server';
import { getDb, logEvent } from '@/lib/db';
import { ensureData } from '@/lib/bootstrap';
import { appendRow } from '@/lib/sheets';
import { loadFromStore } from '@/lib/sync';
const INCOME_TAB = process.env.DAILY_INCOME_TAB || 'Form Responses 2';
import { formatSheetTimestamp } from '@/lib/parser';

export const dynamic = 'force-dynamic';

const INCOME_SOURCES = ['Salary', 'Freelance', 'Commissions', 'Contributions', 'Investment Return', 'Credit Return', 'Credit Taken'];

export async function GET(req) {
  await ensureData();
  const p = new URL(req.url).searchParams;
  const db = getDb();
  const where = ['deleted=0'];
  const args = [];
  if (p.get('month')) { where.push("strftime('%Y-%m', ts)=?"); args.push(p.get('month')); }
  if (p.get('source')) { where.push('source=?'); args.push(p.get('source')); }
  if (p.get('account')) { where.push('account=?'); args.push(p.get('account')); }
  if (p.get('q')) { where.push('remarks LIKE ?'); args.push(`%${p.get('q')}%`); }

  const rows = db.prepare(`SELECT * FROM income WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT 300`).all(...args);
  const bySource = db.prepare(`SELECT source, COALESCE(SUM(amount),0) total, COUNT(*) c FROM income WHERE ${where.join(' AND ')} GROUP BY source ORDER BY total DESC`).all(...args);
  const byAccount = db.prepare(`SELECT account, COALESCE(SUM(amount),0) total FROM income WHERE ${where.join(' AND ')} GROUP BY account ORDER BY total DESC`).all(...args);
  const total = db.prepare(`SELECT COALESCE(SUM(amount),0) t, COUNT(*) c FROM income WHERE ${where.join(' AND ')}`).get(...args);

  return NextResponse.json({ ok: true, rows, bySource, byAccount, total: total.t, count: total.c, sources: INCOME_SOURCES });
}

export async function POST(req) {
  try {
    await ensureData();
    const { amount, source, account, remarks = '', timestamp } = await req.json();
    if (amount === undefined || isNaN(parseFloat(amount))) return err('Amount required');
    if (!INCOME_SOURCES.includes(source)) return err(`Unknown source: ${source}`);
    if (!account) return err('Account required');
    const ts = timestamp ? new Date(timestamp) : new Date();
    const r = await appendRow({
      tab: INCOME_TAB,
      timestamp: formatSheetTimestamp(ts),
      amount: parseFloat(amount),
      method: source,    // column C in the income tab = Source of Income
      category: account, // column D = Bank Account
      remarks,
    });
    logEvent('income_append', { row: r.row, amount, source, account });
    const sync = await loadFromStore();
    return NextResponse.json({ ok: true, row: r.row, sync });
  } catch (e) {
    return err(e.message, 500);
  }
}

function err(message, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
