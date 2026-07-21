'use client';
import { useEffect, useState } from 'react';
import { inr } from '@/components/format';

const CHIP = { over: 'overdue', warn: 'soon', ahead: 'safe', ok: 'paid' };
const LABEL = { over: '🔴 Over', warn: '⚠ Near', ahead: 'Ahead of pace', ok: 'On track' };

export default function BudgetsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  async function load() {
    const r = await fetch('/api/budgets');
    const j = await r.json();
    if (!j.ok) return setError(j.error);
    setData(j);
    setDraft(j.budgets || {});
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function save() {
    setSaving(true);
    try {
      const r = await fetch('/api/budgets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', budgets: draft }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setData(j); setDraft(j.budgets || {});
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  if (error) return <div className="panel">Failed: {error}</div>;
  if (!data) return <div className="panel muted">Loading budgets…</div>;

  const setCat = (cat, val) => setDraft((d) => ({ ...d, [cat]: val }));
  const removeCat = (cat) => setDraft((d) => { const n = { ...d }; delete n[cat]; return n; });

  return (
    <>
      <h1>Category Budgets</h1>

      <div className="kpis">
        <Kpi label="Total budget (month)" value={inr(data.totals.budget)} />
        <Kpi label="Spent so far" value={inr(data.totals.spent)} />
        <Kpi label="Remaining" value={inr(data.totals.remaining)} cls={data.totals.remaining < 0 ? 'red' : 'green'} />
        <Kpi label="Over / near" value={`${data.totals.overCount} / ${data.totals.warnCount}`} cls={data.totals.overCount ? 'red' : ''} />
      </div>

      <div className="panel">
        <h2>This month</h2>
        {data.items.length === 0 && <p className="muted">No budgets yet — add one below.</p>}
        {data.items.map((i) => (
          <div key={i.category} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span><b>{i.category}</b> <span className={`chip ${CHIP[i.status]}`} style={{ marginLeft: 6 }}>{LABEL[i.status]}</span></span>
              <span className="mono">{inr(i.spent)} <span className="muted">/ {inr(i.budget)}</span></span>
            </div>
            <div className="bar"><div style={{ width: `${Math.min(100, i.ratio * 100)}%`, background: i.status === 'over' ? 'var(--red)' : i.status === 'warn' ? 'var(--amber)' : 'var(--green)' }} /></div>
            <div className="muted small" style={{ marginTop: 3 }}>Projected month-end: {inr(i.projected)} · Remaining: {inr(i.remaining)}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Set budgets</h2>
        {Object.entries(draft).map(([cat, val]) => (
          <div className="row" key={cat} style={{ marginBottom: 8, alignItems: 'center' }}>
            <div className="field" style={{ flex: 2 }}><label>Category</label><input value={cat} disabled /></div>
            <div className="field"><label>Monthly ₹</label><input type="number" value={val} onChange={(e) => setCat(cat, e.target.value)} /></div>
            <button className="ghost small danger" onClick={() => removeCat(cat)}>Remove</button>
          </div>
        ))}
        <AddBudget existing={Object.keys(draft)} unbudgeted={data.unbudgeted} onAdd={(c) => setCat(c, 1000)} />
        <div style={{ marginTop: 12 }}>
          <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save budgets'}</button>
        </div>
      </div>
    </>
  );
}

function AddBudget({ existing, unbudgeted, onAdd }) {
  const [cat, setCat] = useState('');
  const options = unbudgeted.filter((u) => !existing.includes(u.category));
  return (
    <div className="row" style={{ alignItems: 'end', marginTop: 6 }}>
      <div className="field" style={{ flex: 2 }}>
        <label>Add a category</label>
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((o) => <option key={o.category} value={o.category}>{o.category} (spent {inr(o.spent)})</option>)}
        </select>
      </div>
      <button className="ghost small" disabled={!cat} onClick={() => { onAdd(cat); setCat(''); }}>Add</button>
    </div>
  );
}

function Kpi({ label, value, cls = '' }) {
  return <div className="kpi"><div className="label">{label}</div><div className={`value ${cls}`}>{value}</div></div>;
}
