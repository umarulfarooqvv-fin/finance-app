'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from 'recharts';
import { inr0 } from '@/components/format';

const COLORS = ['#5b8cff', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#38bdf8', '#fb923c', '#f472b6', '#4ade80', '#facc15', '#94a3b8', '#2dd4bf'];

export default function Charts() {
  const [months, setMonths] = useState(6);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [trendCats, setTrendCats] = useState([]);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/charts?months=${months}`)).json();
      if (!j.ok) throw new Error(j.error);
      setData(j);
      setTrendCats((prev) => prev.length ? prev : j.trendCategories.slice(0, 4));
    } catch (e) { setError(e.message); }
  }, [months]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="panel">Failed: {error}</div>;
  if (!data) return <div className="panel muted">Loading charts…</div>;

  const tooltipStyle = { background: '#1d2430', border: '1px solid #2a3342', borderRadius: 9, color: '#e8edf4' };
  const fmtTick = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v);

  return (
    <>
      <h1>Charts</h1>
      <div className="panel">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted small">Window:</span>
          {[3, 6, 12, 24].map((m) => (
            <button key={m} className={`small ${months === m ? '' : 'ghost'}`} onClick={() => setMonths(m)}>{m} mo</button>
          ))}
          <span className="muted small" style={{ marginLeft: 'auto' }}>{data.window.from} → {data.window.to}</span>
        </div>
      </div>

      <div className="panel">
        <h2>Spend by category — this month</h2>
        <ResponsiveContainer width="100%" height={Math.max(220, data.byCategoryThisMonth.length * 34)}>
          <BarChart data={data.byCategoryThisMonth} layout="vertical" margin={{ left: 40, right: 24 }}>
            <XAxis type="number" tickFormatter={fmtTick} stroke="#8b97a8" />
            <YAxis type="category" dataKey="name" width={110} stroke="#8b97a8" />
            <Tooltip formatter={(v) => inr0(v)} contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
            <Bar dataKey="total" radius={[0, 6, 6, 0]}>
              {data.byCategoryThisMonth.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <h2>Category trend — monthly</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {data.trendCategories.map((c, i) => (
            <button key={c} className="small"
              onClick={() => setTrendCats((x) => x.includes(c) ? x.filter((y) => y !== c) : [...x, c])}
              style={{
                background: trendCats.includes(c) ? `${COLORS[i % COLORS.length]}33` : 'var(--panel2)',
                color: trendCats.includes(c) ? COLORS[i % COLORS.length] : 'var(--muted)',
                border: '1px solid var(--border)',
              }}>
              {c}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data.trend} margin={{ right: 24 }}>
            <CartesianGrid stroke="#2a3342" strokeDasharray="3 3" />
            <XAxis dataKey="month" stroke="#8b97a8" />
            <YAxis tickFormatter={fmtTick} stroke="#8b97a8" />
            <Tooltip formatter={(v) => inr0(v)} contentStyle={tooltipStyle} />
            <Legend />
            {trendCats.map((c) => {
              const i = data.trendCategories.indexOf(c);
              return <Line key={c} type="monotone" dataKey={c} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />;
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <h2>Income vs Expense — monthly</h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.incomeVsExpense} margin={{ right: 24 }}>
            <CartesianGrid stroke="#2a3342" strokeDasharray="3 3" />
            <XAxis dataKey="month" stroke="#8b97a8" />
            <YAxis tickFormatter={fmtTick} stroke="#8b97a8" />
            <Tooltip formatter={(v) => inr0(v)} contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
            <Legend />
            <Bar dataKey="income" fill="#34d399" radius={[5, 5, 0, 0]} />
            <Bar dataKey="expense" fill="#f87171" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="row" style={{ alignItems: 'stretch' }}>
        <div className="panel" style={{ flex: 1, minWidth: 300 }}>
          <h2>Spend by card ({data.months} mo)</h2>
          <PieBlock data={data.byCard} />
        </div>
        <div className="panel" style={{ flex: 1, minWidth: 300 }}>
          <h2>Spend by bank/cash ({data.months} mo)</h2>
          <PieBlock data={data.byAccount} />
        </div>
        <div className="panel" style={{ flex: 1, minWidth: 300 }}>
          <h2>Income by source ({data.months} mo)</h2>
          <PieBlock data={data.incomeBySource} />
        </div>
      </div>
    </>
  );
}

function PieBlock({ data }) {
  if (!data || data.length === 0) return <p className="muted small">No data in window.</p>;
  const tooltipStyle = { background: '#1d2430', border: '1px solid #2a3342', borderRadius: 9, color: '#e8edf4' };
  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="total" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => inr0(v)} contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      <div className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {data.map((d, i) => (
          <span key={d.name}>
            <span style={{ color: COLORS[i % COLORS.length] }}>●</span> {d.name} <b>{inr0(d.total)}</b>
          </span>
        ))}
      </div>
    </>
  );
}
