import { NextResponse } from 'next/server';
import { getDb, logEvent } from '@/lib/db';
import { appendRow } from '@/lib/sheets';
import { loadFromStore } from '@/lib/sync';
import { formatSheetTimestamp, ALL_METHODS, ALL_CATEGORIES, istIso } from '@/lib/parser';
import { ensureData } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  await ensureData();
  const p = new URL(req.url).searchParams;
  const db = getDb();
  const where = ['t.deleted=0'];
  const args = [];
  if (p.get('card')) { where.push('t.card_affected=?'); args.push(p.get('card')); }
  if (p.get('method')) { where.push('t.method=?'); args.push(p.get('method')); }
  if (p.get('category')) { where.push('t.category=?'); args.push(p.get('category')); }
  if (p.get('kind')) { where.push('t.kind=?'); args.push(p.get('kind')); }
  if (p.get('month')) { where.push("strftime('%Y-%m', t.ts)=?"); args.push(p.get('month')); } // YYYY-MM
  if (p.get('q')) { where.push('(t.remarks LIKE ? OR t.category LIKE ? OR t.method LIKE ?)'); const q = `%${p.get('q')}%`; args.push(q, q, q); }
  if (p.get('needsReview') === '1') where.push('t.needs_review=1');
  if (p.get('verified') === '1') where.push('a.verified=1');
  if (p.get('verified') === '0') where.push('(a.verified IS NULL OR a.verified=0)');

  // Filters above apply to both the feed and the upcoming count. The upcoming
  // clause is added only to the feed: pre-logged future rows (e.g. EMI install-
  // ments logged ahead of time) are hidden until their date arrives — they live
  // on /emi and /recurring meanwhile, and surface here automatically once
  // ts <= today. Pass ?upcoming=1 to include them; undated rows always show.
  const now = istIso();
  const feedWhere = [...where];
  if (p.get('upcoming') !== '1') feedWhere.push('(t.ts IS NULL OR t.ts <= ?)');
  const feedArgs = p.get('upcoming') !== '1' ? [...args, now] : args;

  const limit = Math.min(parseInt(p.get('limit') || '200', 10), 1000);
  const offset = parseInt(p.get('offset') || '0', 10);
  const rows = db.prepare(`
    SELECT t.*, COALESCE(a.verified,0) verified, a.note annotation_note
    FROM transactions t LEFT JOIN annotations a ON a.tx_id = t.id
    WHERE ${feedWhere.join(' AND ')}
    ORDER BY t.ts DESC, t.sheet_row DESC
    LIMIT ? OFFSET ?
  `).all(...feedArgs, limit, offset);
  const total = db.prepare(`
    SELECT COUNT(*) c FROM transactions t LEFT JOIN annotations a ON a.tx_id = t.id
    WHERE ${feedWhere.join(' AND ')}
  `).get(...feedArgs).c;
  const upcomingHidden = db.prepare(`
    SELECT COUNT(*) c FROM transactions t LEFT JOIN annotations a ON a.tx_id = t.id
    WHERE ${where.join(' AND ')} AND t.ts > ?
  `).get(...args, now).c;
  return NextResponse.json({ ok: true, rows: rows.map(r => ({ ...r, tags: safeJson(r.tags) })), total, upcomingHidden });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { amount, method, category, remarks = '', timestamp } = body;
    if (!ALL_METHODS.includes(method)) return err(`Unknown method: ${method}`);
    if (!ALL_CATEGORIES.includes(category)) return err(`Unknown category: ${category}`);
    if (amount === undefined || amount === null || isNaN(parseFloat(amount))) return err('Amount required');
    const ts = timestamp ? new Date(timestamp) : new Date();
    const r = await appendRow({
      timestamp: formatSheetTimestamp(ts),
      amount: parseFloat(amount),
      method, category, remarks,
    });
    logEvent('append', { row: r.row, amount, method, category, remarks });
    const sync = await loadFromStore();
    return NextResponse.json({ ok: true, row: r.row, sync });
  } catch (e) {
    return err(e.message, 500);
  }
}

function err(message, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function safeJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }
