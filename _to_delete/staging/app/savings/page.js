'use client';
import { useEffect, useState } from 'react';
import { inr } from '@/components/format';

const BLANK = { kind: 'savings', name: '', institution: '', invested: '', current_value: '', target: '', note: '' };

export default function SavingsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);

  async function load() {
    const r = await fetch('/api/holdings');
    const j = await r.json();
    if (!j.ok) return setError(j.error);
    setData(j);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function post(body) {
    const r = await fetch('/api/holdings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    setData((d) => ({ ...d, ...j }));
  }

  if (error) return <div className="panel">Failed: {error}</div>;
  if (!data) return <div className="panel muted">Loading…</div>;

  const t = data.totals;
  return (
    <>
      <h1>Savings & Investments</h1>
      <div className="kpis">
        <Kpi label="Savings" value={inr(t.savings)} />
        <Kpi label="Investments" value={inr(t.investment)} />
        <Kpi label="Total value" value={inr(t.currentValue)} cls="accent" />
        <Kpi label="Gain / loss" value={inr(t.gain)} cls={t.gain < 0 ? 'red' : 'green'} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setForm({ ...BLANK })}>+ Add holding</button>
      </div>

      <div className="panel tableWrap">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Where</th><th className="num">Invested</th><th className="num">Value</th><th className="num">Gain</th><th>Goal</th><th></th></tr></thead>
          <tbody>
            {data.holdings.map((h) => (
              <tr key={h.id}>
                <td><b>{h.name}</b>{h.note ? <div className="muted small">{h.note}</div> : null}</td>
                <td className="muted">{h.kind}</td>
                <td className="muted">{h.institution || '—'}</td>
                <td className="num muted">{inr(h.invested)}</td>
                <td className="num">{inr(h.current_value)}</td>
                <td className="num" style={{ color: h.current_value - h.invested < 0 ? 'var(--red)' : 'var(--green)' }}>{inr(h.current_value - h.invested)}</td>
                <td style={{ minWidth: 120 }}>
                  {h.goalProgress != null ? (
                    <div>
                      <div className="bar"><div style={{ width: `${h.goalProgress * 100}%`, background: 'var(--accent)' }} /></div>
                      <div className="muted small" style={{ marginTop: 2 }}>{Math.round(h.goalProgress * 100)}% of {inr(h.target)}</div>
                    </div>
                  ) : <span className="muted small">—</span>}
                </td>
                <td>
                  <button className="ghost small" onClick={() => setForm({ ...h, invested: h.invested, current_value: h.current_value, target: h.target || '' })}>Edit</button>{' '}
                  <button className="ghost small danger" onClick={() => post({ action: 'deleteHolding', id: h.id }).catch((e) => setError(e.message))}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.holdings.length === 0 && <p className="muted">No holdings yet.</p>}
      </div>

      {form && (
        <div className="modalOverlay" onClick={(e) => e.target === e.currentTarget && setForm(null)}>
          <div className="modal">
            <h3>{form.id ? 'Edit holding' : 'Add holding'}</h3>
            <div className="field"><label>Type</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="savings">Savings</option><option value="investment">Investment</option>
              </select>
            </div>
            <div className="field"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>Institution (optional)</label><input value={form.institution || ''} onChange={(e) => setForm({ ...form, institution: e.target.value })} /></div>
            <div className="row">
              <div className="field"><label>Invested ₹</label><input type="number" value={form.invested} onChange={(e) => setForm({ ...form, invested: e.target.value })} /></div>
              <div className="field"><label>Current value ₹</label><input type="number" value={form.current_value} onChange={(e) => setForm({ ...form, current_value: e.target.value })} /></div>
            </div>
            <div className="field"><label>Savings goal target ₹ (optional)</label><input type="number" value={form.target || ''} onChange={(e) => setForm({ ...form, target: e.target.value })} /></div>
            <div className="field"><label>Note (optional)</label><input value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="ghost" onClick={() => setForm(null)}>Cancel</button>
              <button onClick={async () => { try { await post({ action: 'saveHolding', holding: form }); setForm(null); } catch (e) { setError(e.message); } }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, cls = '' }) {
  return <div className="kpi"><div className="label">{label}</div><div className={`value ${cls}`}>{value}</div></div>;
}
