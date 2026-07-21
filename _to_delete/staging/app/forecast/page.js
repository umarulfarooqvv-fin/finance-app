'use client';
import { useEffect, useState } from 'react';
import { inr, inr0, shortDate } from '@/components/format';

export default function ForecastPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [method, setMethod] = useState('runrate+recurring');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/forecast?method=${method}`);
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        setData(j);
      } catch (e) { setError(e.message); }
    })();
  }, [method]);

  if (error) return <div className="panel">Failed to load: {error}</div>;
  if (!data) return <div className="panel muted">Loading forecast…</div>;

  return (
    <>
      <h1>Forecast & Reserve</h1>

      <div className="panel" style={{ borderColor: 'var(--accent)' }}>
        <div className="label">Recommended bank reserve</div>
        <div className="value accent" style={{ fontSize: 30, fontWeight: 800, margin: '4px 0' }}>
          {inr(data.recommendedReserve)}
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Keep at least this much in the bank to cover all card dues
          ({inr0(data.totalDebtLive)}) plus projected spend for the rest of {data.period.from.slice(0, 7)}
          ({inr0(data.estimatedRemaining)}).
        </p>
      </div>

      <div className="kpis">
        <Kpi label="Spent so far this month" value={inr(data.monthToDate)} />
        <Kpi label="Daily run-rate" value={inr(data.dailyRunRate)} />
        <Kpi label={`Est. remaining (${data.daysRemaining}d left)`} value={inr(data.estimatedRemaining)} cls="accent" />
        <Kpi label="Total debt (live)" value={inr(data.totalDebtLive)} cls="red" />
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="runrate+recurring">Run-rate + known recurring items</option>
            <option value="runrate">Run-rate only</option>
          </select>
        </div>
      </div>

      <div className="panel">
        <h2>Projected spend by category</h2>
        <table>
          <thead><tr><th>Category</th><th className="num">So far</th><th className="num">Projected month-end</th></tr></thead>
          <tbody>
            {data.byCategory.map((c) => (
              <tr key={c.category}><td>{c.category}</td><td className="num muted">{inr(c.mtd)}</td><td className="num">{inr(c.projected)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Projected spend by card</h2>
        <table>
          <thead><tr><th>Card</th><th className="num">So far</th><th className="num">Projected month-end</th></tr></thead>
          <tbody>
            {data.byCard.map((c) => (
              <tr key={c.card}><td>{c.card}</td><td className="num muted">{inr(c.mtd)}</td><td className="num">{inr(c.projected)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.recurring.length > 0 && (
        <div className="panel">
          <h2>Known recurring still to come this month</h2>
          <table>
            <thead><tr><th>Item</th><th>Date</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {data.recurring.map((r, i) => (
                <tr key={i}><td>{r.name}</td><td className="muted">{shortDate(r.date)}</td><td className="num">{inr(r.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, cls = '' }) {
  return <div className="kpi"><div className="label">{label}</div><div className={`value ${cls}`}>{value}</div></div>;
}
