'use client';
import { useState } from 'react';

export default function Lock() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!pin) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (r.ok) { location.href = '/'; return; }
      setError('Wrong PIN — try again.');
      setPin('');
    } catch {
      setError('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '18vh' }}>
      <form onSubmit={submit} className="panel" style={{ width: 320, textAlign: 'center' }}>
        <div style={{ fontSize: 34, marginBottom: 6 }}>🔒</div>
        <h2 style={{ marginBottom: 4 }}>Personal Finance</h2>
        <p className="muted small" style={{ marginTop: 0 }}>Enter your PIN to continue</p>
        <input
          type="password" inputMode="numeric" autoFocus autoComplete="off"
          value={pin} onChange={(e) => setPin(e.target.value)}
          style={{ textAlign: 'center', fontSize: 22, letterSpacing: 8, marginBottom: 10 }}
        />
        {error && <p className="small" style={{ color: 'var(--red)', marginTop: 0 }}>{error}</p>}
        <button type="submit" disabled={busy || !pin} style={{ width: '100%' }}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
