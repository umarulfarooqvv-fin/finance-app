'use client';
import { useEffect, useState } from 'react';
import { inr, shortDate } from '@/components/format';

const BLANK = { client: '', number: '', amount: '', issued: '', due: '', status: 'draft', note: '' };
const CHIP = { draft: 'kind', sent: 'soon', paid: 'paid' };

export default function FreelancePage() {
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
      <h1>Freelance / Cirqle</h1>
      <div className="kpis">
        <Kpi label="Outstanding" value={inr(t.outstanding)} cls="accent" />
        <Kpi label="Paid" value={inr(t.paid)} cls="green" />
        <Kpi label="Sent" value={inr(t.sent)} />
        <Kpi label="Invoiced total" value={inr(t.total)} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setForm({ ...BLANK })}>+ New invoice</button>
      </div>

      {data.clients.length > 0 && (
        <div className="panel">
          <h2>By client</h2>
          <table>
            <thead><tr><th>Client</th><th className="num">Invoiced</th><th className="num">Outstanding</th><th className="num">Invoices</th></tr></thead>
            <tbody>{data.clients.map((c) => (
              <tr key={c.client}><td><b>{c.client}</b></td><td className="num">{inr(c.total)}</td><td className="num">{inr(c.outstanding)}</td><td className="num muted">{c.count}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="panel tableWrap">
        <table>
          <thead><tr><th>Client</th><th>#</th><th className="num">Amount</th><th>Issued</th><th>Due</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data.invoices.map((inv) => (
              <tr key={inv.id}>
                <td><b>{inv.client}</b></td>
                <td className="muted">{inv.number || '—'}</td>
                <td className="num">{inr(inv.amount)}</td>
                <td className="muted">{inv.issued ? shortDate(inv.issued) : '—'}</td>
                <td className="muted">{inv.due ? shortDate(inv.due) : '—'}</td>
                <td><span className={`chip ${CHIP[inv.status]}`}>{inv.status}</span></td>
                <td>
                  <button className="ghost small" onClick={() => setForm({ ...inv })}>Edit</button>{' '}
                  <button className="ghost small danger" onClick={() => post({ action: 'deleteInvoice', id: inv.id }).catch((e) => setError(e.message))}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.invoices.length === 0 && <p className="muted">No invoices yet.</p>}
      </div>

      {form && (
        <div className="modalOverlay" onClick={(e) => e.target === e.currentTarget && setForm(null)}>
          <div className="modal">
            <h3>{form.id ? 'Edit invoice' : 'New invoice'}</h3>
            <div className="row">
              <div className="field" style={{ flex: 2 }}><label>Client</label><input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} /></div>
              <div className="field"><label>Invoice #</label><input value={form.number || ''} onChange={(e) => setForm({ ...form, number: e.target.value })} /></div>
            </div>
            <div className="row">
              <div className="field"><label>Amount ₹</label><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div className="field"><label>Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="draft">Draft</option><option value="sent">Sent</option><option value="paid">Paid</option>
                </select>
              </div>
            </div>
            <div className="row">
              <div className="field"><label>Issued</label><input type="date" value={form.issued || ''} onChange={(e) => setForm({ ...form, issued: e.target.value })} /></div>
              <div className="field"><label>Due</label><input type="date" value={form.due || ''} onChange={(e) => setForm({ ...form, due: e.target.value })} /></div>
            </div>
            <div className="field"><label>Note</label><input value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="ghost" onClick={() => setForm(null)}>Cancel</button>
              <button onClick={async () => { try { await post({ action: 'saveInvoice', invoice: form }); setForm(null); } catch (e) { setError(e.message); } }}>Save</button>
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
