'use client';
import { useEffect, useState } from 'react';
import { inr } from '@/components/format';

const BLANK = { lender: '', principal: '', borrowed_on: '', due: '', kind: 'personal', note: '' };

export default function CreditTakenPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [pay, setPay] = useState(null);
  const [open, setOpen] = useState(null);

  async function load() {
    const r = await fetch('/api/debts');
    const j = await r.json();
    if (!j.ok) return setError(j.error);
    setData(j);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function post(body) {
    const r = await fetch('/api/debts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    setData((d) => ({ ...d, ...j }));
  }
  const run = (body) => post(body).catch((e) => setError(e.message));

  if (error) return <div className="panel">Failed: {error}</div>;
  if (!data) return <div className="panel muted">Loading…</div>;

  const t = data.totals;
  return (
    <>
      <h1>Credit Taken</h1>
      <p className="muted small">
        Money you&apos;ve borrowed. Outstanding balances are subtracted from Net Worth.
      </p>

      <div className="kpis">
        <Kpi label="Borrowed (total)" value={inr(t.principal)} />
        <Kpi label="Repaid" value={inr(t.repaid)} cls="green" />
        <Kpi label="Balance to pay" value={inr(t.outstanding)} cls="red" />
        <Kpi label="Open / settled" value={`${t.openCount} / ${t.settledCount}`} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setForm({ ...BLANK })}>+ Add debt</button>
      </div>

      <div className="panel tableWrap">
        <table>
          <thead>
            <tr>
              <th>Lender</th>
              <th>Type</th>
              <th>Borrowed</th>
              <th>Due</th>
              <th className="num">Principal</th>
              <th className="num">Repaid</th>
              <th className="num">Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.debts.map((d) => (
              <RowGroup
                key={d.id}
                d={d}
                open={open === d.id}
                onToggle={() => setOpen(open === d.id ? null : d.id)}
                onEdit={() =>
                  setForm({
                    ...d,
                    principal: d.principal,
                    borrowed_on: d.borrowed_on || '',
                    due: d.due || '',
                    note: d.note || '',
                  })
                }
                onPay={() =>
                  setPay({
                    debt_id: d.id,
                    lender: d.lender,
                    amount: '',
                    paid_on: new Date().toISOString().slice(0, 10),
                    note: '',
                  })
                }
                onDelete={() => run({ action: 'deleteDebt', id: d.id })}
                onDeletePayment={(pid) => run({ action: 'deletePayment', id: pid })}
              />
            ))}
          </tbody>
        </table>
        {data.debts.length === 0 && (
          <p className="muted">Nothing borrowed — add a debt to track it.</p>
        )}
      </div>

      {form && (
        <div
          className="modalOverlay"
          onClick={(e) => e.target === e.currentTarget && setForm(null)}
        >
          <div className="modal">
            <h3>{form.id ? 'Edit debt' : 'Add debt'}</h3>
            <div className="field">
              <label>Lender</label>
              <input
                value={form.lender}
                onChange={(e) => setForm({ ...form, lender: e.target.value })}
                placeholder="e.g. Aliyanka"
              />
            </div>
            <div className="row">
              <div className="field">
                <label>Principal ₹</label>
                <input
                  type="number"
                  value={form.principal}
                  onChange={(e) => setForm({ ...form, principal: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Type</label>
                <select
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value })}
                >
                  <option value="personal">Personal</option>
                  <option value="emi">Device / EMI</option>
                  <option value="loan">Loan</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Borrowed on</label>
                <input
                  type="date"
                  value={form.borrowed_on || ''}
                  onChange={(e) => setForm({ ...form, borrowed_on: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Due (optional)</label>
                <input
                  type="date"
                  value={form.due || ''}
                  onChange={(e) => setForm({ ...form, due: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label>Note (optional)</label>
              <input
                value={form.note || ''}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="ghost" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await post({ action: 'saveDebt', debt: form });
                    setForm(null);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {pay && (
        <div className="modalOverlay" onClick={(e) => e.target === e.currentTarget && setPay(null)}>
          <div className="modal">
            <h3>Record repayment — {pay.lender}</h3>
            <div className="row">
              <div className="field">
                <label>Amount ₹</label>
                <input
                  type="number"
                  autoFocus
                  value={pay.amount}
                  onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Paid on</label>
                <input
                  type="date"
                  value={pay.paid_on}
                  onChange={(e) => setPay({ ...pay, paid_on: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label>Note (optional)</label>
              <input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="ghost" onClick={() => setPay(null)}>
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await post({ action: 'addPayment', payment: pay });
                    setPay(null);
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RowGroup({ d, open, onToggle, onEdit, onPay, onDelete, onDeletePayment }) {
  return (
    <>
      <tr style={d.settled ? { opacity: 0.55 } : undefined}>
        <td>
          <b>{d.lender}</b>
          {d.settled ? (
            <span className="chip paid" style={{ marginLeft: 6 }}>
              settled
            </span>
          ) : null}
          {d.note ? <div className="muted small">{d.note}</div> : null}
        </td>
        <td className="muted">{d.kind}</td>
        <td className="muted">{d.borrowed_on || '—'}</td>
        <td className="muted">{d.due || '—'}</td>
        <td className="num muted">{inr(d.principal)}</td>
        <td className="num">
          {inr(d.repaid)}
          {d.payments.length ? (
            <button className="ghost small" style={{ marginLeft: 6 }} onClick={onToggle}>
              {open ? 'hide' : `${d.payments.length}`}
            </button>
          ) : null}
        </td>
        <td className="num" style={{ color: d.balance > 0 ? 'var(--red)' : 'var(--green)' }}>
          {inr(d.balance)}
        </td>
        <td>
          {!d.settled && (
            <>
              <button className="ghost small" onClick={onPay}>
                Repay
              </button>{' '}
            </>
          )}
          <button className="ghost small" onClick={onEdit}>
            Edit
          </button>{' '}
          <button className="ghost small danger" onClick={onDelete}>
            Delete
          </button>
        </td>
      </tr>
      {open &&
        d.payments.map((p) => (
          <tr key={p.id} className="muted small">
            <td colSpan={4} style={{ paddingLeft: 24 }}>
              ↳ repayment {p.paid_on || ''} {p.note ? `— ${p.note}` : ''}
            </td>
            <td></td>
            <td className="num">{inr(p.amount)}</td>
            <td></td>
            <td>
              <button className="ghost small danger" onClick={() => onDeletePayment(p.id)}>
                Remove
              </button>
            </td>
          </tr>
        ))}
    </>
  );
}

function Kpi({ label, value, cls = '' }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value ${cls}`}>{value}</div>
    </div>
  );
}
