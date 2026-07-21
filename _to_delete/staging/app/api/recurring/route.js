import { NextResponse } from 'next/server';
import { getDb, logEvent } from '@/lib/db';
import { ensureData } from '@/lib/bootstrap';
import { getDefs, saveDefs, newDef, defStatus, recurringOverview, buildPostRow } from '@/lib/recurring';
import { appendRow } from '@/lib/sheets';
import { syncFromSheet } from '@/lib/sync';
import { ALL_METHODS, ALL_CATEGORIES } from '@/lib/parser';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureData();
    return NextResponse.json({ ok: true, ...recurringOverview() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await ensureData();
    const body = await req.json();
    const db = getDb();
    const defs = getDefs(db);

    if (body.action === 'add') {
      const d = body.def || {};
      if (!d.name || !d.amount || isNaN(parseFloat(d.amount))) return err('Name and amount required');
      if (!ALL_METHODS.includes(d.method)) return err(`Unknown method: ${d.method}`);
      if (!ALL_CATEGORIES.includes(d.category)) return err(`Unknown category: ${d.category}`);
      if (!d.firstDate) return err('First date required');
      const def = newDef(d);
      defs.push(def);
      await saveDefs(defs, db);
      logEvent('recurring_add', def);
      return NextResponse.json({ ok: true, def: defStatus(def, db) });
    }

    if (body.action === 'delete') {
      const next = defs.filter((d) => d.id !== body.id);
      if (next.length === defs.length) return err('Not found', 404);
      await saveDefs(next, db);
      logEvent('recurring_delete', { id: body.id });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'post') {
      const def = defs.find((d) => d.id === body.id);
      if (!def) return err('Not found', 404);
      const st = defStatus(def, db);
      const occ = body.k !== undefined ? st.due.find((o) => o.k === body.k) : st.due[0];
      if (!occ) return err('Nothing due to post for this item');
      const row = buildPostRow(def, occ.k);
      const r = await appendRow(row);
      logEvent('recurring_post', { id: def.id, k: occ.k, row: r.row });
      await syncFromSheet();
      return NextResponse.json({ ok: true, row: r.row, posted: row });
    }

    return err('Unknown action');
  } catch (e) {
    return err(e.message, 500);
  }
}

function err(message, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
