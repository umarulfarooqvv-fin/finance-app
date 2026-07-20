'use client';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { inr, shortDate } from '@/components/format';

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    if (!q.trim()) { setData(null); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        setData(j);
      } catch (e) { setError(e.message); }
    }, 200);
    return () => clearTimeout(timer.current);
  }, [q]);

  return (
    <>
      <h1>Search</h1>
      <div className="panel">
        <input autoFocus placeholder="Search transactions, income, invoices, holdings…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <div className="panel">Failed: {error}</div>}
      {data && data.total === 0 && <p className="muted">No matches for “{data.query}”.</p>}
      {data && data.groups.map((g) => (
        <div className="panel" key={g.type}>
          <h2>{g.label} ({g.items.length})</h2>
          <table>
            <tbody>
              {g.items.map((it) => (
                <tr key={it.id}>
                  <td className="muted" style={{ width: 90 }}>{it.date ? shortDate(it.date) : ''}</td>
                  <td>{renderItem(g.type, it)}</td>
                  <td className="num">{it.amount != null ? inr(it.amount) : it.current_value != null ? inr(it.current_value) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function renderItem(type, it) {
  if (type === 'transactions') return <span><b>{it.category}</b> · {it.method} <span className="muted">— {it.remarks}</span></span>;
  if (type === 'income') return <span><b>{it.source}</b> · {it.account} <span className="muted">— {it.remarks}</span></span>;
  if (type === 'invoices') return <span><b>{it.client}</b> {it.number || ''} <span className="chip kind">{it.status}</span></span>;
  if (type === 'holdings') return <span><b>{it.name}</b> <span className="muted">{it.kind} · {it.institution || ''}</span></span>;
  return JSON.stringify(it);
}
