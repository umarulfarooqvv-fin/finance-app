'use client';
import { useEffect, useState } from 'react';
import { inr, shortDate } from '@/components/format';

export default function EmiPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/emi');
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        setData(j);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  if (error) return <div className="panel">Failed: {error}</div>;
  if (!data) return <div className="panel muted">Loading EMIs…</div>;

  return (
    <>
      <h1>EMI Tracker</h1>
      <div className="kpis">
        <Kpi label="Active EMIs" value={data.totals.activeCount} />
        <Kpi label="Monthly outgo" value={inr(data.totals.monthlyOutgo)} cls="red" />
        <Kpi label="Remaining principal" value={inr(data.totals.remainingPrincipal)} />
      </div>

      <div className="panel tableWrap">
        <table>
          <thead>
            <tr><th>Item</th><th>Card</th><th className="num">Installment</th><th>Progress</th><th>Next due</th><th className="num">Est. total</th><th></th></tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.name}>
                <td><b>{i.name}</b>{i.finished && <span className="chip paid" style={{ marginLeft: 6 }}>Done</span>}</td>
                <td className="muted">{i.card}</td>
                <td className="num">{inr(i.installment)}</td>
                <td>{i.paidCount}{i.totalInstallments ? ` / ${i.totalInstallments}` : ''} paid</td>
                <td className="muted">{i.nextDueDate ? shortDate(i.nextDueDate) : '—'}</td>
                <td className="num muted">{i.estimatedTotal ? inr(i.estimatedTotal) : '—'}</td>
                <td><button className="ghost small" onClick={() => setOpen(open === i.name ? null : i.name)}>{open === i.name ? 'Hide' : 'Schedule'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.items.length === 0 && <p className="muted">No EMIs detected. EMIs are recognised from remarks like <code>Item 5/24</code>.</p>}
      </div>

      {open && (
        <div className="panel">
          <h2>{open} — schedule</h2>
          <table>
            <thead><tr><th>Date</th><th>#</th><th>Component</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {data.items.find((i) => i.name === open).schedule.map((s, k) => (
                <tr key={k}>
                  <td className="muted">{s.date ? shortDate(s.date) : '—'}</td>
                  <td>{s.n}/{s.m}</td>
                  <td className="muted">{s.component}</td>
                  <td className="num">{inr(s.amount)}</td>
                  <td>{s.posted ? <span className="chip paid">Posted</span> : <span className="chip soon">Upcoming</span>}</td>
                </tr>
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
