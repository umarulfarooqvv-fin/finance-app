'use client';
import { useEffect, useState, useCallback } from 'react';
import { inr, inr0 } from '@/components/format';

export default function Balances() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [since, setSince] = useState('');

  const load = useCallback(async () => {
    try {
      const j = await (await fetch('/api/balances')).json();
      if (!j.ok) throw new Error(j.error);
      setData(j); setSince(j.since || '');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function put(body, okMsg) {
    const r = await fetch('/api/balances', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) note(j.error, true);
    else { note(okMsg); setData(j); setSince(j.since || ''); }
  }

  function note(msg, isErr = false) {
    setToast({ msg, isErr });
    setTimeout(() => setToast(null), 3500);
  }

  if (error) return <div className="panel">Failed: {error}</div>;
  if (!data) return <div className="panel muted">Loading balances…</div>;

  return (
    <>
      <h1>Balances</h1>

      <div className="kpis">
        <div className="kpi"><div className="label">Total in banks + cash</div>
          <div className={`value ${data.totalBankBalance >= 0 ? 'green' : 'red'}`}>{inr(data.totalBankBalance)}</div></div>
        <div className="kpi"><div className="label">Available credit (cards)</div>
          <div className="value accent">{data.totalAvailableCredit ? inr0(data.totalAvailableCredit) : 'set limits'}</div></div>
      </div>

      <div className="panel">
        <h2>Count from (tracking start)</h2>
        <p className="muted small">
          Balance = opening balance + income − spends − card bills paid, counted from this date.
          Set it to the day you started tracking everything, and set each account&apos;s opening
          balance to its real balance on that day — then app balances match your banks.
        </p>
        <div className="row">
          <div className="field" style={{ maxWidth: 220 }}>
            <label>Count from date (blank = all history)</label>
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          </div>
          <button onClick={() => put({ since }, since ? `Counting from ${since}` : 'Counting all history')}>Apply</button>
        </div>
      </div>

      <h2 style={{ margin: '18px 0 10px' }}>Bank & cash accounts</h2>
      {data.accounts.map((a) => <AccountRow key={a.account} a={a} onSave={(opening) => put({ account: a.account, opening }, `${a.account} opening saved`)} />)}

      {data.unassignedIncome.count > 0 && (
        <div className="panel small" style={{ borderColor: 'var(--amber)' }}>
          ⚠ {data.unassignedIncome.count} income entr{data.unassignedIncome.count > 1 ? 'ies' : 'y'} totalling{' '}
          <b>{inr0(data.unassignedIncome.total)}</b> have account &quot;None&quot; — they&apos;re not counted in any
          balance. Edit them in the sheet to assign an account.
        </div>
      )}

      <h2 style={{ margin: '18px 0 10px' }}>Cards — available to spend</h2>
      <div className="panel tableWrap">
        <table>
          <thead><tr><th>Card</th><th className="num">Live debt</th><th className="num">Credit limit</th><th className="num">Available</th></tr></thead>
          <tbody>
            {data.cards.map((c) => (
              <tr key={c.card}>
                <td style={{ color: c.color, fontWeight: 600 }}>{c.card}</td>
                <td className="num">{inr(c.liveDebt)}</td>
                <td className="num muted">{c.creditLimit ? inr0(c.creditLimit) : '—'}</td>
                <td className="num" style={{ fontWeight: 600, color: c.available === null ? 'var(--muted)' : c.available > 0 ? 'var(--green)' : 'var(--red)' }}>
                  {c.available === null ? 'set limit' : inr0(c.available)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ marginBottom: 0 }}>Set credit limits in the Cards page to see availability.</p>
      </div>

      {toast && <div className={`toast ${toast.isErr ? 'err' : ''}`}>{toast.msg}</div>}
    </>
  );
}

function AccountRow({ a, onSave }) {
  const [opening, setOpening] = useState(a.opening);
  const dirty = parseFloat(opening || 0) !== a.opening;
  return (
    <div className="panel">
      <div className="row" style={{ alignItems: 'center' }}>
        <div style={{ minWidth: 90, fontWeight: 700, color: a.color }}>{a.account}</div>
        <div className="field" style={{ maxWidth: 180 }}>
          <label>Opening balance (₹)</label>
          <input type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} />
        </div>
        <button className={dirty ? '' : 'ghost'} disabled={!dirty} onClick={() => onSave(parseFloat(opening || 0))}>Save</button>
        <div style={{ flex: 1 }} />
        <div className="small muted" style={{ textAlign: 'right' }}>
          + income {inr0(a.income)}<br />− outflow {inr0(a.outflow)}
        </div>
        <div style={{ minWidth: 130, textAlign: 'right' }}>
          <div className="label muted small">Balance</div>
          <div style={{ fontSize: 19, fontWeight: 700, color: a.balance >= 0 ? 'var(--green)' : 'var(--red)' }}>{inr(a.balance)}</div>
        </div>
      </div>
    </div>
  );
}
