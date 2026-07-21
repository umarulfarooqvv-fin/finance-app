'use client';
import { useEffect, useState, useCallback } from 'react';
import { inr, inr0 } from '@/components/format';

const METHODS = ['Fi', 'Jupiter', 'Cash', 'Perks', 'Edge', 'One Card', 'ICICI', 'Coral', 'Scapia', 'Super Money'];
const CATEGORIES = ['Personal', 'Family', 'Food', 'Fuel', 'Entertainment', 'Maintenance', 'Surcharge', 'Taxes', 'Gifts/Donations', 'Credit Given'];

export default function Recurring() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState(null);
  const [openSeries, setOpenSeries] = useState({});

  const load = useCallback(async () => {
    try {
      const j = await (await fetch('/api/recurring')).json();
      if (!j.ok) throw new Error(j.error);
      setData(j); setError(null);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function note(msg, isErr = false) {
    setToast({ msg, isErr });
    setTimeout(() => setToast(null), 4000);
  }

  async function act(body, okMsg) {
    const r = await fetch('/api/recurring', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) note(j.error, true); else { note(okMsg); load(); }
    return j;
  }

  if (error) return <div className="panel">Failed: {error}</div>;
  if (!data) return <div className="panel muted">Loading recurring items…</div>;

  return (
    <>
      <h1>Recurring <span className="muted small">EMIs & subscriptions</span></h1>

      {data.dueCount > 0 && (
        <div className="panel" style={{ borderColor: 'var(--amber)' }}>
          ⚠ <b>{data.dueCount}</b> occurrence{data.dueCount > 1 ? 's' : ''} due — date passed but not yet in the sheet. Post below.
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <button onClick={() => setShowAdd(true)}>＋ Add recurring item</button>
      </div>

      {data.defs.length === 0 && (
        <div className="panel muted">
          No recurring items yet. Add subscriptions (e.g. iCloud, Minoxidil) or EMIs here.
          Use {'{n}'}/{'{m}'} in remarks for installment counters, e.g. <code>Sheya&apos;s {'{n}'}/{'{m}'} Emi</code>.
        </div>
      )}

      {data.defs.map((d) => (
        <div className="panel" key={d.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 16 }}>{d.name}</b>
            <span className="chip kind">{inr(d.amount)} / month</span>
            <span className="chip kind">{d.method} · {d.category}</span>
            <span className="chip kind">day {d.dayOfMonth}</span>
            {d.months
              ? <span className={`chip ${d.finished ? 'paid' : 'safe'}`}>{d.finished ? '✅ finished' : `${d.postedCount}/${d.months} paid`}</span>
              : <span className="chip safe">open-ended · {d.postedCount} posted</span>}
            <span style={{ flex: 1 }} />
            <button className="ghost small danger" onClick={() => confirm(`Delete "${d.name}"?`) && act({ action: 'delete', id: d.id }, 'Deleted')}>Delete</button>
          </div>

          {d.due.length > 0 && d.due.map((o) => (
            <div key={o.k} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: 10, background: 'rgba(251,191,36,.07)', borderRadius: 9 }}>
              <span>🟡 <b>{o.date}</b> — {o.remarks} — {inr(d.amount)}</span>
              <span style={{ flex: 1 }} />
              <button className="small" onClick={() => act({ action: 'post', id: d.id, k: o.k }, 'Posted to sheet')}>Post to sheet</button>
            </div>
          ))}

          {d.nextUpcoming && !d.finished && (
            <p className="muted small" style={{ marginBottom: 0 }}>
              Next: {d.nextUpcoming.date} — {d.nextUpcoming.remarks}
            </p>
          )}
        </div>
      ))}

      <h2 style={{ marginTop: 24 }}>Upcoming already in the sheet</h2>
      <p className="muted small">
        Pre-logged future rows (like the iPad EMIs). They&apos;re excluded from all balances and
        analytics until their date arrives — no action needed, they activate automatically.
      </p>
      {data.sheetUpcoming.length === 0 && <div className="panel muted">Nothing pre-logged.</div>}
      {data.sheetUpcoming.map((g) => (
        <div className="panel" key={g.series}>
          <button className="ghost" style={{ width: '100%', textAlign: 'left' }}
            onClick={() => setOpenSeries((o) => ({ ...o, [g.series]: !o[g.series] }))}>
            {openSeries[g.series] ? '▾' : '▸'} {g.series}{' '}
            <span className="muted small">({g.items.length} upcoming · {inr0(g.total)} total)</span>
          </button>
          {openSeries[g.series] && (
            <div className="tableWrap" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>Date</th><th className="num">Amount</th><th>Method</th><th>Category</th><th>Remarks</th></tr></thead>
                <tbody>
                  {g.items.map((t) => (
                    <tr key={t.id}>
                      <td className="muted">{t.date}</td>
                      <td className="num">{inr(t.amount)}</td>
                      <td>{t.method}</td>
                      <td className="muted">{t.category}</td>
                      <td style={{ whiteSpace: 'normal' }}>{t.remarks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); note('Recurring item added'); load(); }} onError={(m) => note(m, true)} />}
      {toast && <div className={`toast ${toast.isErr ? 'err' : ''}`}>{toast.msg}</div>}
    </>
  );
}

function AddModal({ onClose, onSaved, onError }) {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const [f, setF] = useState({
    name: '', amount: '', method: 'Fi', category: 'Personal', remarks: '',
    firstDate: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    months: '', dayOfMonth: '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await fetch('/api/recurring', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', def: { ...f, months: f.months || null, dayOfMonth: f.dayOfMonth || null, remarks: f.remarks || f.name } }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      onSaved();
    } catch (e) { onError(`Save failed: ${e.message}`); setSaving(false); }
  }

  return (
    <div className="modalOverlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>Add recurring item</h3>
        <div className="field"><label>Name (used to match posted transactions)</label>
          <input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. iCloud storage / Minoxidil / Sheya Emi" autoFocus />
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="field"><label>Amount (₹/month)</label>
            <input type="number" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} />
          </div>
          <div className="field"><label>Installments (blank = open-ended)</label>
            <input type="number" min="1" value={f.months} onChange={(e) => set('months', e.target.value)} placeholder="e.g. 24" />
          </div>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="field"><label>Method</label>
            <select value={f.method} onChange={(e) => set('method', e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          </div>
          <div className="field"><label>Category</label>
            <select value={f.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="field"><label>First occurrence</label>
            <input type="date" value={f.firstDate} onChange={(e) => set('firstDate', e.target.value)} />
          </div>
          <div className="field"><label>Day of month (blank = from first date)</label>
            <input type="number" min="1" max="28" value={f.dayOfMonth} onChange={(e) => set('dayOfMonth', e.target.value)} />
          </div>
        </div>
        <div className="field"><label>Remarks template — {'{n}'}/{'{m}'} = installment counter</label>
          <input value={f.remarks} onChange={(e) => set('remarks', e.target.value)} placeholder={'e.g. iPad Pro {n}/{m} (Cirqle)'} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button onClick={save} disabled={saving || !f.name || !f.amount}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );

  function set(k, v) { setF((p) => ({ ...p, [k]: v })); }
}
