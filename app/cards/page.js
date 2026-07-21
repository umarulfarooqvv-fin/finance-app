'use client';
import { useEffect, useState } from 'react';
import { inr0 } from '@/components/format';

export default function CardsPage() {
  const [cards, setCards] = useState(null);
  const [toast, setToast] = useState(null);

  async function load() {
    const j = await (await fetch('/api/cards')).json();
    if (j.ok) setCards(j.cards);
  }
  useEffect(() => { load(); }, []);

  async function save(card) {
    const r = await fetch('/api/cards', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });
    const j = await r.json();
    setToast(j.ok ? `${card.name} saved` : `Failed: ${j.error}`);
    setTimeout(() => setToast(null), 3000);
    if (j.ok) load();
  }

  if (!cards) return <div className="panel muted">Loading cards…</div>;

  return (
    <>
      <h1>Card Settings</h1>
      <p className="muted small">
        Bill date = day the statement generates. Due day + cycle = when payment is due
        (from your Card_Settings). Credit limit drives Utilization %. Opening balance is the
        carried debt on the track-start date (so older history isn&apos;t double-counted).
      </p>
      {cards.map((c) => <CardRow key={c.name} card={c} onSave={save} />)}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function CardRow({ card, onSave }) {
  const [f, setF] = useState({ ...card });
  const dirty = JSON.stringify(f) !== JSON.stringify(card);
  return (
    <div className="panel">
      <div className="row">
        <div className="field" style={{ minWidth: 140 }}>
          <label>Card</label>
          <div style={{ fontWeight: 700, color: f.color, padding: '8px 0' }}>{card.name}</div>
        </div>
        <div className="field"><label>Bill date (day)</label>
          <input type="number" min="1" max="28" value={f.bill_date} onChange={(e) => set('bill_date', parseInt(e.target.value || '1', 10))} />
        </div>
        <div className="field" style={{ maxWidth: 90 }}><label>Due day</label>
          <input type="number" min="1" max="28" value={f.due_day || ''} onChange={(e) => set('due_day', e.target.value ? parseInt(e.target.value, 10) : null)} placeholder="—" />
        </div>
        <div className="field" style={{ maxWidth: 110 }}><label>Due cycle</label>
          <select value={f.due_cycle || 'same'} onChange={(e) => set('due_cycle', e.target.value)}>
            <option value="same">Same month</option><option value="next">Next month</option>
          </select>
        </div>
        <div className="field"><label>Credit limit (₹) — {f.credit_limit ? inr0(f.credit_limit) : 'not set'}</label>
          <input type="number" min="0" step="1000" value={f.credit_limit || ''} onChange={(e) => set('credit_limit', parseFloat(e.target.value || '0'))} placeholder="e.g. 100000" />
        </div>
        <div className="field"><label>Opening balance (₹)</label>
          <input type="number" step="1" value={f.opening_balance || ''} onChange={(e) => set('opening_balance', parseFloat(e.target.value || '0'))} placeholder="0" />
        </div>
        <div className="field" style={{ maxWidth: 130 }}><label>Track start</label>
          <input type="date" value={f.opening_date || ''} onChange={(e) => set('opening_date', e.target.value || null)} />
        </div>
        <div className="field" style={{ maxWidth: 90 }}><label>Active</label>
          <select value={f.active ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')}>
            <option value="1">Yes</option><option value="0">No</option>
          </select>
        </div>
        <button onClick={() => onSave(f)} disabled={!dirty}>Save</button>
      </div>
    </div>
  );

  function set(k, v) { setF((p) => ({ ...p, [k]: v })); }
}
