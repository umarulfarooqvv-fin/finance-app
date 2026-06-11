'use client';
import { useEffect, useState, use as useUnwrap } from 'react';
import Link from 'next/link';
import { inr, sheetDate, shortDate, shortDateTime } from '@/components/format';

export default function CardPanel({ params }) {
  const { name } = useUnwrap(params);
  const cardName = decodeURIComponent(name);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('live'); // 'live' | 'bill'
  const [sort, setSort] = useState({ key: 'ts', dir: 'asc' });

  async function load() {
    try {
      const r = await fetch(`/api/card/${encodeURIComponent(cardName)}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setData(j);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [cardName]);

  async function toggleVerify(tx) {
    await fetch(`/api/transactions/${tx.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', verified: !tx.verified }),
    });
    load();
  }

  if (error) return <div className="panel">Failed: {error} — <Link href="/">back</Link></div>;
  if (!data) return <div className="panel muted">Loading {cardName}…</div>;

  const { card, statement: s, reconciliation: rec } = data;
  const rows = view === 'live' ? data.liveRows : data.billRows;
  const sorted = [...rows].sort((a, b) => {
    let va, vb;
    if (sort.key === 'ts') { va = a.ts || ''; vb = b.ts || ''; }
    else { va = a.amount || 0; vb = b.amount || 0; }
    const c = va < vb ? -1 : va > vb ? 1 : 0;
    return sort.dir === 'asc' ? c : -c;
  });

  const verified = view === 'live' ? rec.liveVerified : rec.billVerified;
  const unverified = view === 'live' ? rec.liveUnverified : rec.billUnverified;

  return (
    <>
      <h1 style={{ color: card.color }}>{card.name}</h1>

      <div className="kpis">
        <Kpi label="Statement Ends" value={sheetDate(s.statementEnd)} />
        <Kpi label="Due Date" value={sheetDate(s.dueDate)} />
        <Kpi label="Remaining Due (Bill)" value={inr(s.remainingDueBill)} cls={s.remainingDueBill > 0 ? 'red' : 'green'} />
        <Kpi label="Total Debt (Live)" value={inr(s.totalDebtLive)} cls="red" />
        <Kpi label="Unbilled" value={inr(s.unbilled)} />
      </div>

      <div className="panel">
        <h2>Cycle Math</h2>
        <div className="mono" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 14 }}>
          <span>Opening <b>{inr(s.cycleMath.openingBalance)}</b></span>
          <span>+ Spends <b>{inr(s.cycleMath.cycleSpends)}</b></span>
          <span>− Repayments <b>{inr(s.cycleMath.cycleRepayments)}</b></span>
          <span>= Closing <b style={{ color: 'var(--accent)' }}>{inr(s.cycleMath.closingBalance)}</b></span>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Cycle {shortDate(s.cycleStart)} → {shortDate(s.statementEnd)} · bill day {card.billDate}, +{card.graceDays} grace days
        </p>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <button className={view === 'live' ? '' : 'ghost'} onClick={() => setView('live')}>Live / Unbilled</button>
          <button className={view === 'bill' ? '' : 'ghost'} onClick={() => setView('bill')}>Bill (last statement)</button>
          <span className="spacer" style={{ flex: 1 }} />
          <span className="small">
            <span style={{ color: 'var(--green)' }}>Verified: {inr(verified)}</span>
            {' · '}
            <span style={{ color: 'var(--amber)' }}>Unverified: {inr(unverified)}</span>
          </span>
        </div>

        {view === 'bill' && <p className="small muted">To Pay: <b style={{ color: 'var(--text)' }}>{inr(s.remainingDueBill)}</b></p>}

        {sorted.length === 0 ? (
          <p className="muted">✅ Bill cleared. No new spends yet.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>✓</th>
                  <th onClick={() => flip('ts')} style={{ cursor: 'pointer' }}>Date {arrow('ts')}</th>
                  <th>Description</th>
                  {view === 'bill' && <th>Category</th>}
                  <th className="num" onClick={() => flip('amount')} style={{ cursor: 'pointer' }}>Debit {arrow('amount')}</th>
                  <th className="num">Credit</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button className={`verify ${t.verified ? 'on' : ''}`} title={t.verified ? 'Verified — click to unverify' : 'Mark verified'} onClick={() => toggleVerify(t)}>✓</button>
                    </td>
                    <td className="muted">{shortDateTime(t.ts)}</td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>{t.remarks || <span className="muted">(no remarks)</span>}</td>
                    {view === 'bill' && <td className="muted">{t.category}</td>}
                    <td className="num">{t.card_direction === 'debt+' ? inr(t.amount) : ''}</td>
                    <td className="num" style={{ color: 'var(--green)' }}>{t.card_direction === 'debt-' ? inr(t.amount) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Activity</h2>
        {data.activity.map((t) => (
          <div key={t.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
            {t.card_direction === 'debt-' ? '➖' : '➕'}{' '}
            <b>{inr(t.amount)}</b>{' '}
            <span className="muted">{t.card_direction === 'debt-' ? 'Payment' : 'Billed expense'} · {shortDateTime(t.ts)} · {t.remarks}</span>
          </div>
        ))}
      </div>
    </>
  );

  function flip(key) { setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' })); }
  function arrow(key) { return sort.key === key ? (sort.dir === 'asc' ? '↑' : '↓') : ''; }
}

function Kpi({ label, value, cls = '' }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value ${cls}`} style={{ fontSize: 15 }}>{value}</div>
    </div>
  );
}
