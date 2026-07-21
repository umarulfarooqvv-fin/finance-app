'use client';
import { useEffect, useState, useCallback } from 'react';
import { inr, inr0 } from '@/components/format';

const ALL_METHODS = ['Fi', 'Jupiter', 'Cash', 'Perks', 'Edge', 'One Card', 'ICICI', 'Coral', 'Scapia', 'Super Money'];

function isoToday(offsetMonths = 0, day = null) {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth() + offsetMonths, day ?? d.getDate());
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

export default function DetailedExpenses() {
  const [from, setFrom] = useState(isoToday(0, 1));
  const [to, setTo] = useState(isoToday());
  const [exCats, setExCats] = useState([]);
  const [exMethods, setExMethods] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openGroups, setOpenGroups] = useState({});

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ from, to });
      if (exCats.length) p.set('excludeCats', exCats.join(','));
      if (exMethods.length) p.set('excludeMethods', exMethods.join(','));
      const j = await (await fetch(`/api/detailed?${p}`)).json();
      if (!j.ok) throw new Error(j.error);
      setData(j); setError(null);
    } catch (e) { setError(e.message); }
  }, [from, to, exCats, exMethods]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="panel">Failed: {error}</div>;
  if (!data) return <div className="panel muted">Loading detailed expenses…</div>;

  const cats = data.current.breakdown.filter((b) => b.total !== 0 || !exCats.includes(b.category));
  const maxCat = Math.max(...data.current.breakdown.map((b) => b.total), 1);
  const maxDaily = Math.max(...data.daily.map((d) => d.total), 1);

  return (
    <>
      <h1>Detailed Expenses</h1>

      {/* Range controls */}
      <div className="panel">
        <div className="row">
          <div className="field"><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Preset label="This month" onClick={() => { setFrom(isoToday(0, 1)); setTo(isoToday()); }} />
          <Preset label="Last month" onClick={() => { setFrom(isoToday(-1, 1)); setTo(isoToday(0, 0)); }} />
          <Preset label="Last 90 days" onClick={() => { const d = new Date(Date.now() - 89 * 86400000); setFrom(d.toISOString().slice(0, 10)); setTo(isoToday()); }} />
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          {data.range.days} days selected · {data.range.daysTillToday} days till today
        </p>
      </div>

      {/* KPIs */}
      <div className="kpis">
        <Kpi label="Total (selected)" value={inr(data.current.total)} cls="accent" />
        <Kpi label="Daily average" value={inr(data.current.total / Math.max(1, data.range.days))} />
        <Kpi label={`1 month before (${data.prevMonth.window?.[0]?.slice(0, 10) ?? ''} →)`} value={inr(data.prevMonth.total)} />
        <Kpi label="Same range 1 year ago" value={inr(data.prevYear.total)} />
        <Kpi label="Transactions" value={data.current.count} />
      </div>

      {/* Filters */}
      <div className="panel">
        <h2>Include / exclude</h2>
        <div className="small muted" style={{ marginBottom: 6 }}>Categories</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {data.current.breakdown.map((b) => (
            <Toggle key={b.category} label={b.category} active={!exCats.includes(b.category)}
              onClick={() => setExCats((x) => x.includes(b.category) ? x.filter((c) => c !== b.category) : [...x, b.category])} />
          ))}
        </div>
        <div className="small muted" style={{ marginBottom: 6 }}>Payment methods</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ALL_METHODS.map((m) => (
            <Toggle key={m} label={m} active={!exMethods.includes(m)}
              onClick={() => setExMethods((x) => x.includes(m) ? x.filter((c) => c !== m) : [...x, m])} />
          ))}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="panel">
        <h2>Categories ({data.range.from} → {data.range.to})</h2>
        {cats.filter((b) => b.total > 0).map((b) => (
          <div key={b.category} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
            <span style={{ width: 130, fontSize: 14 }}>{b.category}</span>
            <div className="bar" style={{ flex: 1 }}>
              <div style={{ width: `${(b.total / maxCat) * 100}%`, background: 'var(--accent)' }} />
            </div>
            <span className="mono small" style={{ width: 110, textAlign: 'right' }}>{inr0(b.total)}</span>
            <span className="muted small" style={{ width: 44, textAlign: 'right' }}>{(b.share * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>

      {/* Comparison */}
      <div className="panel tableWrap">
        <h2>Comparison</h2>
        <table>
          <thead>
            <tr><th>Category</th><th className="num">Selected</th><th className="num">1 Mo before</th><th className="num">Δ vs Mo</th><th className="num">1 Yr ago</th><th className="num">Δ vs Yr</th></tr>
          </thead>
          <tbody>
            {data.comparison.filter((c) => c.current || c.prevMonth || c.prevYear).map((c) => (
              <tr key={c.category}>
                <td>{c.category}</td>
                <td className="num">{inr0(c.current)} <span className="muted small">({(c.currentShare * 100).toFixed(0)}%)</span></td>
                <td className="num muted">{inr0(c.prevMonth)}</td>
                <td className="num" style={{ color: c.deltaMonth > 0 ? 'var(--red)' : 'var(--green)' }}>{c.deltaMonth > 0 ? '+' : ''}{inr0(c.deltaMonth)}</td>
                <td className="num muted">{inr0(c.prevYear)}</td>
                <td className="num" style={{ color: c.deltaYear > 0 ? 'var(--red)' : 'var(--green)' }}>{c.deltaYear > 0 ? '+' : ''}{inr0(c.deltaYear)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Daily */}
      <div className="panel">
        <h2>Daily spend (selected range)</h2>
        {data.daily.map((d) => (
          <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
            <span className="muted small" style={{ width: 80 }}>{d.date.slice(5)}</span>
            <div className="bar" style={{ flex: 1 }}>
              <div style={{ width: `${(d.total / maxDaily) * 100}%`, background: 'var(--green)' }} />
            </div>
            <span className="mono small" style={{ width: 90, textAlign: 'right' }}>{inr0(d.total)}</span>
            <span className="muted small" style={{ width: 100, textAlign: 'right' }}>Σ {inr0(d.cumulative)}</span>
          </div>
        ))}
      </div>

      {/* Monthly trend */}
      <div className="panel tableWrap">
        <h2>Monthly trend</h2>
        <table>
          <thead><tr><th>Month</th><th className="num">Total</th><th className="num">Δ prev</th><th className="num">Cumulative</th><th>Top category</th></tr></thead>
          <tbody>
            {data.monthly.map((m) => {
              const top = Object.entries(m.byCat).sort((a, b) => b[1] - a[1])[0];
              return (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td className="num">{inr0(m.total)}</td>
                  <td className="num" style={{ color: m.delta === null ? undefined : m.delta > 0 ? 'var(--red)' : 'var(--green)' }}>
                    {m.delta === null ? '—' : `${m.delta > 0 ? '+' : ''}${inr0(m.delta)}`}
                  </td>
                  <td className="num muted">{inr0(m.cumulative)}</td>
                  <td className="muted small">{top ? `${top[0]} (${inr0(top[1])})` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Grouped transactions */}
      <div className="panel">
        <h2>Transactions by category</h2>
        {data.groups.map((g) => (
          <div key={g.category} style={{ marginBottom: 8 }}>
            <button className="ghost" style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setOpenGroups((o) => ({ ...o, [g.category]: !o[g.category] }))}>
              {openGroups[g.category] ? '▾' : '▸'} {g.category}{' '}
              <span className="muted small">({g.transactions.length} · {inr0(g.transactions.reduce((a, t) => a + t.amount, 0))})</span>
            </button>
            {openGroups[g.category] && (
              <div className="tableWrap" style={{ marginTop: 6 }}>
                <table>
                  <thead><tr><th>Date</th><th className="num">Amount</th><th>Method</th><th>Remarks</th></tr></thead>
                  <tbody>
                    {g.transactions.map((t) => (
                      <tr key={t.id}>
                        <td className="muted">{t.date}</td>
                        <td className="num">{inr(t.amount)}</td>
                        <td>{t.method}</td>
                        <td style={{ whiteSpace: 'normal', maxWidth: 380 }}>{t.remarks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Kpi({ label, value, cls = '' }) {
  return <div className="kpi"><div className="label">{label}</div><div className={`value ${cls}`}>{value}</div></div>;
}
function Preset({ label, onClick }) {
  return <button className="ghost small" style={{ alignSelf: 'end' }} onClick={onClick}>{label}</button>;
}
function Toggle({ label, active, onClick }) {
  return (
    <button className="small" onClick={onClick}
      style={{ background: active ? 'rgba(91,140,255,.18)' : 'var(--panel2)', color: active ? 'var(--accent)' : 'var(--muted)', border: '1px solid var(--border)' }}>
      {active ? '✓ ' : ''}{label}
    </button>
  );
}
