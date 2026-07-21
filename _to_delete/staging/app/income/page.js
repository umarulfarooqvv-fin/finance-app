'use client';
import { useEffect, useState, useCallback } from 'react';
import { inr, inr0, shortDateTime } from '@/components/format';

const SOURCES = ['Salary', 'Freelance', 'Commissions', 'Contributions', 'Investment Return', 'Credit Return', 'Credit Taken'];
const ACCOUNTS = ['Fi', 'Jupiter', 'SBI', 'Cash'];

export default function Income() {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ month: '', source: '', account: '', q: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    const j = await (await fetch(`/api/income?${p}`)).json();
    if (j.ok) setData(j);
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  function note(msg, isErr = false) {
    setToast({ msg, isErr });
    setTimeout(() => setToast(null), 4000);
  }

  if (!data) return <div className="panel muted">Loading income…</div>;

  return (
    <>
      <h1>Income <span className="muted small">({data.count})</span></h1>

      <div className="kpis">
        <div className="kpi"><div className="label">Total (filtered)</div><div className="value green">{inr(data.total)}</div></div>
        {data.bySource.slice(0, 4).map((s) => (
          <div className="kpi" key={s.source}><div className="label">{s.source}</div><div className="value" style={{ fontSize: 16 }}>{inr0(s.total)}</div></div>
        ))}
      </div>

      <div className="panel">
        <div className="row">
          <div className="field"><label>Month</label><input type="month" value={filters.month} onChange={(e) => setF('month', e.target.value)} /></div>
          <div className="field"><label>Source</label>
            <select value={filters.source} onChange={(e) => setF('source', e.target.value)}><option value="">All</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
          </div>
          <div className="field"><label>Account</label>
            <select value={filters.account} onChange={(e) => setF('account', e.target.value)}><option value="">All</option>{ACCOUNTS.map((a) => <option key={a}>{a}</option>)}<option>None</option></select>
          </div>
          <div className="field"><label>Search</label><input value={filters.q} onChange={(e) => setF('q', e.target.value)} placeholder="remarks…" /></div>
          <button onClick={() => setShowAdd(true)}>＋ Add income</button>
        </div>
      </div>

      <div className="panel tableWrap">
        <table>
          <thead><tr><th>Date</th><th className="num">Amount</th><th>Source</th><th>Account</th><th>Remarks</th></tr></thead>
          <tbody>
            {data.rows.map((t) => (
              <tr key={t.id}>
                <td className="muted">{t.ts ? shortDateTime(t.ts) : t.ts_raw}</td>
                <td className="num" style={{ color: 'var(--green)', fontWeight: 600 }}>{inr(t.amount)}</td>
                <td>{t.source}</td>
                <td>{t.account === 'None' || !t.account ? <span className="chip soon">unassigned</span> : t.account}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>{t.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && <AddIncome onClose={() => setShowAdd(false)} onSaved={(m) => { setShowAdd(false); note(m); load(); }} onError={(m) => note(m, true)} />}
      {toast && <div className={`toast ${toast.isErr ? 'err' : ''}`}>{toast.msg}</div>}
    </>
  );

  function setF(k, v) { setFilters((f) => ({ ...f, [k]: v })); }
}

function AddIncome({ onClose, onSaved, onError }) {
  const [f, setF] = useState({ amount: '', source: 'Freelance', account: 'Fi', remarks: '', timestamp: '' });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await fetch('/api/income', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, timestamp: f.timestamp || undefined }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      onSaved(`Income added (row ${j.row})`);
    } catch (e) { onError(`Save failed: ${e.message}`); setSaving(false); }
  }

  return (
    <div className="modalOverlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>Add income</h3>
        <div className="field"><label>Amount (₹)</label>
          <input type="number" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} autoFocus />
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="field"><label>Source</label>
            <select value={f.source} onChange={(e) => set('source', e.target.value)}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select>
          </div>
          <div className="field"><label>Into account</label>
            <select value={f.account} onChange={(e) => set('account', e.target.value)}>{ACCOUNTS.map((a) => <option key={a}>{a}</option>)}</select>
          </div>
        </div>
        <div className="field"><label>Remarks</label>
          <input value={f.remarks} onChange={(e) => set('remarks', e.target.value)} placeholder="e.g. VKM / Salary June" />
        </div>
        <div className="field"><label>Date & time (blank = now)</label>
          <input type="datetime-local" value={f.timestamp} onChange={(e) => set('timestamp', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button onClick={save} disabled={saving || !f.amount}>{saving ? 'Saving…' : 'Save to sheet'}</button>
        </div>
      </div>
    </div>
  );

  function set(k, v) { setF((p) => ({ ...p, [k]: v })); }
}
