import { ensureData } from '@/lib/bootstrap';
import { exportJson, exportCsv } from '@/lib/exportData';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  await ensureData();
  const p = new URL(req.url).searchParams;
  const format = p.get('format') || 'json';
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    if (format === 'csv') {
      const table = p.get('table') || 'transactions';
      const body = exportCsv(table);
      return new Response(body, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="finance-${table}-${stamp}.csv"`,
        },
      });
    }
    const body = JSON.stringify(exportJson(), null, 2);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="finance-backup-${stamp}.json"`,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
}
