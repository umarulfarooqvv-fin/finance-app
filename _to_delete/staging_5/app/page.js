'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { inr, sheetDate } from '@/components/format';

const STATUS_CHIP = { Paid: 'paid', Safe: 'safe', 'Due Soon': 'soon', Overdue: 'overdue' };
const STATUS_ICON = { Paid: '✅ Paid', Safe: 'Safe', 'Due Soon': '⚠ Due Soon', Overdue: '🔴 Overdue' };

export default function StatementView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // auto-sync on load, then fetch the view
        await fetch('/api/sync', { method: 'POST' }).catch(() => {});
        const r = await fetch('/api/statement');
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        setData(j);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  if (error) return <div className="panel">Failed to load: {error}</div>;
  if (!data) return <div className="panel muted">Loading statements…</div>;

  const { rows, totals } = data;

  return (
    <>
      <h1>Statement View</h1>

      <div className="kpis">
        <Kpi label="Σ Remaining Due (Bill)" value={inr(totals.remainingDueBill)} cls={totals.remainingDueBill > 0 ? 'red' : 'green'} />
        <Kpi label="Σ Total Debt (Live)" value={inr(totals.totalDebtLive)} cls="red" />
        <Kpi label="Σ Unbilled" value={inr(totals.unbilled)} />
        <Kpi label="Σ Rem Due (Excl. Credit)" value={inr(totals.remainingDueExcl)} />
        <Kpi label="Σ Total Debt (Excl. Credit)" value={inr(totals.totalDebtExcl)} />
        <Kpi label="Aggregate Utilization" value={totals.utilization !== null ? `${(totals.utilization * 100).toFixed(1)}%` : 'set limits'} cls="accent" />
      </div>

      <div className="panel tableWrap">
        <table>
          <thead>
            <tr>
              <th>Card</th><th>Statement Ends</th><th>Due Date</th><th>Days Left</th>
              <th className="num">Remaining Due</th><th className="num">Total Debt (Live)</th>
              <th>Utilization</th><th>Status</th><th className="num">Unbilled</th>
              <th className="num">Rem Due (Excl. Cr)</th><th className="num">Debt (Excl. Cr)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.card}>
                <td>
                  <Link href={`/card/${encodeURIComponent(r.card)}`} style={{ color: r.color, fontWeight: 600, textDecoration: 'none' }}>
                    {r.card}
                  </Link>
                </td>
                <td className="muted">{sheetDate(r.statementEnd)}</td>
                <td>{sheetDate(r.dueDate)}</td>
                <td>{r.daysLeft >= 0 ? `${r.daysLeft} Days` : `${-r.daysLeft}d ago`}</td>
                <td className="num">{inr(r.remainingDueBill)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{inr(r.totalDebtLive)}</td>
                <td><Utilization value={r.utilization} color={r.color} /></td>
                <td><span className={`chip ${STATUS_CHIP[r.status]}`}>{STATUS_ICON[r.status]}</span></td>
                <td className="num">{inr(r.unbilled)}</td>
                <td className="num muted">{inr(r.remainingDueExcl)}</td>
                <td className="num muted">{inr(r.totalDebtExcl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted small">
        Pre-logged future EMI rows are excluded until their date arrives. Tap a card name for its statement panel.
        Utilization needs credit limits — set them in <Link href="/cards">Cards</Link>.
      </p>
    </>
  );
}

function Kpi({ label, value, cls = '' }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value ${cls}`}>{value}</div>
    </div>
  );
}

function Utilization({ value, color }) {
  if (value === null) return <span className="muted small">—</span>;
  const pct = Math.min(100, Math.max(0, value * 100));
  const barColor = pct > 60 ? 'var(--red)' : pct > 30 ? 'var(--amber)' : (color || 'var(--green)');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="bar" style={{ flex: 1 }}><div style={{ width: `${pct}%`, background: barColor }} /></div>
      <span className="small mono">{(value * 100).toFixed(1)}%</span>
    </div>
  );
}
