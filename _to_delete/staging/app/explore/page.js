'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { inr, inr0, shortDateTime } from '@/components/format';

const CATEGORIES = ['', 'Family', 'Food', 'Fuel', 'Personal', 'Entertainment', 'Maintenance', 'Surcharge', 'Taxes', 'Gifts/Donations', 'Credit Given'];
const METHODS = ['', 'Fi', 'Jupiter', 'Cash', 'Perks', 'Edge', 'One Card', 'ICICI', 'Coral', 'Scapia', 'Super Money'];
const QUICK = ['barber', 'fuel', 'tea', 'movie', 'recharge', 'saloon', 'gym', 'shawarma'];

export default function Explore() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set('q', q.trim());
      if (category) p.set('category', category);
      if (method) p.set('method', method);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const j = await (await fetch(`/api/explore?${p}`)).json();
      if (!j.ok) throw new Error(j.error);
      setData(j); setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [q, category, method, from, to]);

  // load lifetime view on mount; re-run on filter change with small debounce for typing
  useEffect(() => {
    const t = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const tooltipStyle = { background: '#1d2430', border: '1px solid #2a3342', borderRadius: 9, color: '#e8edf4' };
  const fmtTick = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v);

  return (
    <>
      <h1>Explore <span className="muted small">lifetime trends & keyword search</span></h1>

      <div className="panel">
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Keyword (remarks / category / method)</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. barber, fuel, tea, gym…" autoFocus />
          </div>
          <div className="field"><label>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{c || 'All'}</option>)}</select>
          </div>
          <div className="field"><label>Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m} value={m}>{m || 'All'}</option>)}</select>
          </div>
          <div className="field"><label>From (blank = lifetime)</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {QUICK.map((k) => (
            <button key={k} className="ghost small" onClick={() => setQ(k)}>{k}</button>
          ))}
          {(q || category || method || from || to) && (
            <button className="small danger" onClick={() => { setQ(''); setCategory(''); setMethod(''); setFrom(''); setTo(''); }}>✕ Clear</button>
          )}
        </div>
      </div>

      {error && <div className="panel">Failed: {error}</div>}
      {!data && !error && <div className="panel muted">Loading…</div>}

      {data && (
        <>
          <div className="kpis" style={{ opacity: loading ? 0.5 : 1 }}>
            <Kpi label={q ? `Total — “${q}”` : 'Lifetime spend'} value={inr(data.kpis.total)} cls="accent" />
            <Kpi label="Entries" value={data.kpis.count} />
            <Kpi label="Monthly average" value={inr0(data.kpis.monthlyAvg)} />
            <Kpi label="Avg per entry" value={inr0(data.kpis.perTxAvg)} />
            <Kpi label="First → Last" value={data.kpis.first ? `${data.kpis.first} → ${data.kpis.last}` : '—'} small />
          </div>

          <div className="panel">
            <h2>Monthly trend {q && <span className="muted small">— “{q}”</span>}</h2>
            {data.monthly.length === 0 ? <p className="muted">No matching spends.</p> : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={data.monthly} margin={{ right: 24 }}>
                  <CartesianGrid stroke="#2a3342" strokeDasharray="3 3" />
                  <XAxis dataKey="month" stroke="#8b97a8" />
                  <YAxis yAxisId="l" tickFormatter={fmtTick} stroke="#8b97a8" />
                  <YAxis yAxisId="r" orientation="right" tickFormatter={fmtTick} stroke="#8b97a8" />
                  <Tooltip formatter={(v) => inr0(v)} contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                  <Legend />
                  <Bar yAxisId="l" dataKey="total" name="monthly" fill="#5b8cff" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="r" type="monotone" dataKey="cumulative" name="cumulative" stroke="#34d399" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {(data.byCategory.length > 1 || data.byMethod.length > 1) && (
            <div className="row" style={{ alignItems: 'stretch' }}>
              <div className="panel" style={{ flex: 1, minWidth: 280 }}>
                <h2>Matches by category</h2>
                <MiniBars data={data.byCategory} />
              </div>
              <div className="panel" style={{ flex: 1, minWidth: 280 }}>
                <h2>Matches by method</h2>
                <MiniBars data={data.byMethod} />
              </div>
            </div>
          )}

          <div className="panel tableWrap">
            <h2>Raw data <span className="muted small">({data.kpis.count}{data.truncated ? ', showing latest 500' : ''})</span></h2>
            <table>
              <thead><tr><th>Date</th><th className="num">Amount</th><th>Method</th><th>Category</th><th>Remarks</th></tr></thead>
              <tbody>
                {data.rows.map((t) => (
                  <tr key={t.id}>
                    <td className="muted">{shortDateTime(t.ts)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{inr(t.amount)}</td>
                    <td>{t.method}</td>
                    <td className="muted">{t.category}</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 380 }}>{t.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, cls = '', small }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value ${cls}`} style={small ? { fontSize: 13 } : undefined}>{value}</div>
    </div>
  );
}

function MiniBars({ data }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  return data.slice(0, 8).map((d) => (
    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <span className="small" style={{ width: 110 }}>{d.name}</span>
      <div className="bar" style={{ flex: 1 }}><div style={{ width: `${(d.total / max) * 100}%`, background: 'var(--accent)' }} /></div>
      <span className="mono small" style={{ width: 90, textAlign: 'right' }}>{inr0(d.total)}</span>
    </div>
  ));
}
