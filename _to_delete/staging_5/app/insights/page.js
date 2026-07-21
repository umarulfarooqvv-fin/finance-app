'use client';
import { useEffect, useState } from 'react';
import { inr, shortDate } from '@/components/format';

export default function InsightsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/insights');
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        setData(j);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  if (error) return <div className="panel">Failed: {error}</div>;
  if (!data) return <div className="panel muted">Loading insights…</div>;

  return (
    <>
      <h1>Insights</h1>

      <div className="panel">
        <h2>Daily spend (last 6 months)</h2>
        <Heatmap days={data.heatmap.days} max={data.heatmap.max} />
      </div>

      {data.anomalies.length > 0 && (
        <div className="panel">
          <h2>Unusual spends this month</h2>
          <table>
            <thead><tr><th>Date</th><th>Category</th><th>Remarks</th><th className="num">Amount</th><th className="num">vs typical</th></tr></thead>
            <tbody>
              {data.anomalies.map((a) => (
                <tr key={a.id}>
                  <td className="muted">{shortDate(a.date)}</td>
                  <td>{a.category}</td>
                  <td className="muted">{a.remarks}</td>
                  <td className="num">{inr(a.amount)}</td>
                  <td className="num"><span className="chip soon">{a.ratio}×</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h2>Trips</h2>
        {data.trips.length === 0 && <p className="muted">No trip-tagged spend yet. Tag with <code>(Trip Name)</code> in remarks.</p>}
        {data.trips.map((tr) => (
          <div key={tr.trip} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <b>{tr.trip}</b><span className="mono">{inr(tr.total)}</span>
            </div>
            <div className="muted small">{shortDate(tr.from)} – {shortDate(tr.to)} · {tr.count} transactions</div>
            <div className="small" style={{ marginTop: 4 }}>
              {Object.entries(tr.byCategory).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
                <span key={c} className="chip kind" style={{ marginRight: 6 }}>{c} {inr(v)}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Heatmap({ days, max }) {
  const map = new Map(days.map((d) => [d.date, d.total]));
  if (days.length === 0) return <p className="muted">No data.</p>;
  const start = new Date(days[0].date + 'T00:00:00');
  const end = new Date(days[days.length - 1].date + 'T00:00:00');
  // align to week start (Sunday)
  const first = new Date(start); first.setDate(first.getDate() - first.getDay());
  const cells = [];
  for (let d = new Date(first); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const total = map.get(iso) || 0;
    const intensity = max > 0 ? total / max : 0;
    cells.push({ iso, total, intensity });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const color = (i, total) => total === 0 ? 'var(--panel2)' : `rgba(91,140,255,${0.18 + i * 0.82})`;
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {weeks.map((w, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {w.map((c) => (
              <div key={c.iso} title={`${c.iso}: ${inr(c.total)}`}
                style={{ width: 12, height: 12, borderRadius: 3, background: color(c.intensity, c.total) }} />
            ))}
          </div>
        ))}
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>Peak day: {inr(max)}. Hover a cell for the day's total.</div>
    </div>
  );
}
