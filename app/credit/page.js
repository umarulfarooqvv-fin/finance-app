'use client';
import { useEffect, useState, useCallback } from 'react';
import { inr, inr0 } from '@/components/format';

export default function CreditGiven() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState({});
  const [toast, setToast] = useState(null);
  const [showSettled, setShowSettled] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch('/api/credit')).json();
      if (!j.ok) throw new Error(j.error);
      setData(j);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function note(msg, isErr = false) {
    setToast({ msg, isErr });
    setTimeout(() => setToast(null), 3500);
  }

  async function act(body, okMsg) {
    const r = await fetch('/api/credit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) note(j.error, true);
    else { setData(j); note(okMsg); }
  }

  if (error) return <div className="panel">Failed: {error}</div>;
  if (!data) return <div className="panel muted">Loading credit ledger…</div>;

  const people = data.people.filter((p) => showSettled || p.outstanding > 0);

  return (
    <>
      <h1>Credit Given</h1>

      <div className="kpis">
        <div className="kpi"><div className="label">Outstanding</div><div className="value red">{inr(data.totals.outstanding)}</div></div>
        <div className="kpi"><div className="label">Total given</div><div className="value">{inr0(data.totals.given)}</div></div>
        <div className="kpi"><div className="label">Received back</div><div className="value green">{inr0(data.totals.received)}</div></div>
        <div className="kpi"><div className="label">Open entries</div><div className="value">{data.totals.openCount}</div></div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <button className="ghost small" onClick={() => setShowSettled((s) => !s)}>
          {showSettled ? 'Hide fully settled people' : 'Show fully settled people'}
        </button>
      </div>

      {people.map((p) => (
        <div className="panel" key={p.person}>
          <button className="ghost" style={{ width: '100%', textAlign: 'left' }}
            onClick={() => setOpen((o) => ({ ...o, [p.person]: !o[p.person] }))}>
            {open[p.person] ? '▾' : '▸'} <b>{p.person}</b>{' '}
            {p.outstanding > 0
              ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>owes {inr0(p.outstanding)}</span>
              : <span style={{ color: 'var(--green)' }}>✅ settled</span>}
            <span className="muted small"> · given {inr0(p.given)} · received {inr0(p.received)} · {p.entries.length} entr{p.entries.length > 1 ? 'ies' : 'y'}</span>
          </button>

          {open[p.person] && (
            <div style={{ marginTop: 8 }}>
              {p.entries.map((e) => <Entry key={e.id} e={e} act={act} note={note} />)}
            </div>
          )}
        </div>
      ))}

      <h2 style={{ marginTop: 24 }}>Repayments received (for reference)</h2>
      <p className="muted small">
        "Credit Return" entries from your income tab and card bills cleared with credit-given money.
        Use these to decide what to mark received above.
      </p>
      <div className="panel tableWrap">
        <table>
          <thead><tr><th>Date</th><th className="num">Amount</th><th>Via</th><th>Remarks</th></tr></thead>
          <tbody>
            {data.suggestions.creditReturns.map((r) => (
              <tr key={r.id}>
                <td className="muted">{r.date}</td>
                <td className="num" style={{ color: 'var(--green)' }}>{inr(r.amount)}</td>
                <td>{r.account}</td>
                <td style={{ whiteSpace: 'normal' }}>{r.remarks}</td>
              </tr>
            ))}
            {data.suggestions.clearedViaCard.map((r) => (
              <tr key={r.id}>
                <td className="muted">{r.date}</td>
                <td className="num" style={{ color: 'var(--green)' }}>{inr(r.amount)}</td>
                <td>{r.method} → {r.category}</td>
                <td style={{ whiteSpace: 'normal' }}>{r.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toast && <div className={`toast ${toast.isErr ? 'err' : ''}`}>{toast.msg}</div>}
    </>
  );
}

function Entry({ e, act, note }) {
  const [partial, setPartial] = useState('');
  const [showPartial, setShowPartial] = useState(false);
  const [person, setPerson] = useState('');
  const [showAssign, setShowAssign] = useState(false);

  const chip = e.status === 'received'
    ? <span className="chip paid">✅ received</span>
    : e.status === 'partial'
      ? <span className="chip soon">partial {inr0(e.receivedAmount)} / {inr0(e.amount)}</span>
      : <span className="chip overdue">open</span>;

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="muted small" style={{ minWidth: 80 }}>{e.date}</span>
        <b style={{ minWidth: 90 }}>{inr(e.amount)}</b>
        <span className="chip kind">{e.method}</span>
        {chip}
        <span className="muted small" style={{ flex: 1, whiteSpace: 'normal' }}>{e.remarks}</span>
        {e.status !== 'received' ? (
          <>
            <button className="small" onClick={() => act({ action: 'receive', txId: e.id }, 'Marked received ✅')}>✓ Received</button>
            <button className="ghost small" onClick={() => setShowPartial((s) => !s)}>Partial</button>
          </>
        ) : (
          <button className="ghost small" onClick={() => act({ action: 'reopen', txId: e.id }, 'Reopened')}>Undo</button>
        )}
        <button className="ghost small" onClick={() => setShowAssign((s) => !s)} title="Assign to person">👤</button>
      </div>
      {showPartial && (
        <div className="row" style={{ marginTop: 8 }}>
          <div className="field" style={{ maxWidth: 160 }}>
            <label>Amount received so far</label>
            <input type="number" step="0.01" value={partial} onChange={(ev) => setPartial(ev.target.value)} autoFocus />
          </div>
          <button className="small" disabled={!partial} onClick={() => {
            if (parseFloat(partial) >= e.amount) act({ action: 'receive', txId: e.id }, 'Marked received ✅');
            else act({ action: 'partial', txId: e.id, amount: parseFloat(partial) }, 'Partial recorded');
            setShowPartial(false);
          }}>Save</button>
        </div>
      )}
      {showAssign && (
        <div className="row" style={{ marginTop: 8 }}>
          <div className="field" style={{ maxWidth: 220 }}>
            <label>Person (groups all matching entries)</label>
            <input value={person} onChange={(ev) => setPerson(ev.target.value)} placeholder={e.person} autoFocus />
          </div>
          <button className="small" disabled={!person.trim()} onClick={() => {
            act({ action: 'assign', txId: e.id, person: person.trim() }, `Assigned to ${person.trim()}`);
            setShowAssign(false); setPerson('');
          }}>Assign</button>
        </div>
      )}
    </div>
  );
}
