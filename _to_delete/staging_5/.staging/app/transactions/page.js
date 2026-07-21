'use client';
import { useEffect, useState, useCallback } from 'react';
import { inr, shortDateTime } from '@/components/format';

const METHODS = ['Fi', 'Jupiter', 'Cash', 'Perks', 'Edge', 'One Card', 'ICICI', 'Coral', 'Scapia', 'Super Money'];
const CATEGORIES = ['Family', 'Food', 'Fuel', 'Personal', 'Gifts/Donations', 'Maintenance', 'Entertainment', 'Surcharge', 'Taxes', 'Credit Given', 'Edge', 'One Card', 'ICICI', 'Coral', 'Scapia', 'Super Money'];
const KINDS = ['spend', 'card_payment', 'credit_given', 'emi', 'unknown'];

export default function Transactions() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ q: '', month: '', method: '', category: '', kind: '', verified: '' });
  const [modal, setModal] = useState(null); // null | {mode:'add'} | {mode:'edit', tx}
  const [toast, setToast] = useState(null);
  const [writes, setWrites] = useState(true);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v !== '') p.set(k, v);
    p.set('limit', '300');
    const r = await fetch(`/api/transactions?${p}`);
    const j = await r.json();
    if (j.ok) { setRows(j.rows); setTotal(j.total); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/sync').then((r) => r.json()).then((j) => setWrites(Boolean(j.writesEnabled))).catch(() => {});
  }, []);

  function note(msg, isErr = false) {
    setToast({ msg, isErr });
    setTimeout(() => setToast(null), 4000);
  }

  async function toggleVerify(tx) {
    setRows((rs) => rs.map((r) => (r.id === tx.id ? { ...r, verified: r.verified ? 0 : 1 } : r)));
    const r = await fetch(`/api/transactions/${tx.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', verified: !tx.verified }),
    });
    const j = await r.json();
    if (!j.ok) { note(`Verify failed: ${j.error}`, true); load(); }
    else if (!j.sheetSynced && writes) note('Verified locally (sheet metadata sync pending)');
  }

  return (
    <>
      <h1>Transactions <span className="muted small">({total})</span></h1>

      {!writes && (
        <div className="panel small" style={{ borderColor: 'var(--amber)' }}>
          ⚠ Write access not configured — adding/editing is disabled. Follow <b>SETUP.md</b> to deploy the Apps Script, then set <code>APPS_SCRIPT_URL</code> + <code>APPS_SCRIPT_TOKEN</code> in <code>.env.local</code>. Verify flags still work locally.
        </div>
      )}

      <div className="panel">
        <div className="row">
          <div className="field"><label>Search</label><input value={filters.q} onChange={(e) => setF('q', e.target.value)} placeholder="remarks…" /></div>
          <div className="field"><label>Month</label><input type="month" value={filters.month} onChange={(e) => setF('month', e.target.value)} /></div>
          <div className="field"><label>Method</label>
            <select value={filters.method} onChange={(e) => setF('method', e.target.value)}><option value="">All</option>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          </div>
          <div className="field"><label>Category</label>
            <select value={filters.category} onChange={(e) => setF('category', e.target.value)}><option value="">All</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div className="field"><label>Kind</label>
            <select value={filters.kind} onChange={(e) => setF('kind', e.target.value)}><option value="">All</option>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          </div>
          <div className="field"><label>Reconciliation</label>
            <select value={filters.verified} onChange={(e) => setF('verified', e.target.value)}>
              <option value="">All</option><option value="1">Verified</option><option value="0">Unverified</option>
            </select>
          </div>
          <button onClick={() => setModal({ mode: 'add' })} disabled={!writes}>＋ Add</button>
        </div>
      </div>

      <div className="panel tableWrap">
        <table>
          <thead>
            <tr><th>✓</th><th>Date</th><th className="num">Amount</th><th>Method</th><th>Category</th><th>Remarks</th><th>Kind</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} style={t.needs_review ? { background: 'rgba(251,191,36,.05)' } : undefined}>
                <td><button className={`verify ${t.verified ? 'on' : ''}`} onClick={() => toggleVerify(t)}>✓</button></td>
                <td className="muted">
                  {t.ts ? shortDateTime(t.ts) : <span style={{ color: 'var(--amber)' }}>{t.ts_raw || '—'}</span>}
                  {t.ts && new Date(t.ts) > new Date() && <span className="chip soon" style={{ marginLeft: 6 }}>upcoming</span>}
                </td>
                <td className="num" style={{ fontWeight: 600 }}>{t.amount === null ? <span style={{ color: 'var(--amber)' }}>blank</span> : inr(t.amount)}</td>
                <td>{t.method}</td>
                <td>{t.category}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: 300 }}>
                  {t.remarks}
                  {t.tags?.trip && <span className="chip kind" style={{ marginLeft: 6 }}>🧳 {t.tags.trip}</span>}
                  {t.tags?.cirqle && <span className="chip kind" style={{ marginLeft: 6 }}>Cirqle</span>}
                  {t.tags?.emi?.n && <span className="chip kind" style={{ marginLeft: 6 }}>EMI {t.tags.emi.n}/{t.tags.emi.m}</span>}
                </td>
                <td><span className="chip kind">{t.kind}</span></td>
                <td><button className="ghost small" onClick={() => setModal({ mode: 'edit', tx: t })} disabled={!writes}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <TxModal
          mode={modal.mode}
          tx={modal.tx}
          onClose={() => setModal(null)}
          onSaved={(msg) => { setModal(null); note(msg); load(); }}
          onError={(msg) => note(msg, true)}
        />
      )}
      {toast && <div className={`toast ${toast.isErr ? 'err' : ''}`}>{toast.msg}</div>}
    </>
  );

  function setF(k, v) { setFilters((f) => ({ ...f, [k]: v })); }
}

function TxModal({ mode, tx, onClose, onSaved, onError }) {
  const [form, setForm] = useState(() =>
    mode === 'edit'
      ? { amount: tx.amount ?? '', method: tx.method, category: tx.category, remarks: tx.remarks, timestamp: tx.ts ? tx.ts.slice(0, 16) : '' }
      : { amount: '', method: 'Fi', category: 'Food', remarks: '', timestamp: '' }
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      let r;
      if (mode === 'add') {
        r = await fetch('/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, timestamp: form.timestamp || undefined }),
        });
      } else {
        r = await fetch(`/api/transactions/${tx.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'edit',
            amount: form.amount === '' ? null : parseFloat(form.amount),
            method: form.method,
            category: form.category,
            remarks: form.remarks,
            // keep the original raw timestamp unless the user changed the field
            timestamp: form.timestamp && form.timestamp !== (tx.ts || '').slice(0, 16) ? toSheetTs(form.timestamp) : undefined,
          }),
        });
      }
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      onSaved(mode === 'add' ? `Added to sheet (row ${j.row})` : 'Row updated in sheet');
    } catch (e) {
      onError(`Save failed: ${e.message}`);
      setSaving(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{mode === 'add' ? 'Add transaction' : `Edit row ${tx.sheet_row}`}</h3>
        <div className="field"><label>Amount (₹)</label>
          <input type="number" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} autoFocus />
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="field"><label>Method (paid with)</label>
            <select value={form.method} onChange={(e) => set('method', e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          </div>
          <div className="field"><label>Category</label>
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <p className="muted small" style={{ marginTop: -4 }}>Tip: choosing a card name as Category records a payment TO that card.</p>
        <div className="field"><label>Remarks</label>
          <textarea rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} placeholder="e.g. Tea with snacks (Trip …) / Name 17/24" />
        </div>
        <div className="field"><label>Date & time {mode === 'add' ? '(blank = now)' : ''}</label>
          <input type="datetime-local" value={form.timestamp} onChange={(e) => set('timestamp', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button onClick={save} disabled={saving || form.amount === ''}>{saving ? 'Saving…' : 'Save to sheet'}</button>
        </div>
      </div>
    </div>
  );

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
}

function toSheetTs(dtLocal) {
  const d = new Date(dtLocal);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
