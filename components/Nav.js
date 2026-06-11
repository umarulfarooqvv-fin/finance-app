'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const LINKS = [
  ['/', 'Statements'],
  ['/detailed', 'Expenses'],
  ['/recurring', 'Recurring'],
  ['/transactions', 'Transactions'],
  ['/cards', 'Cards'],
];

export default function Nav() {
  const path = usePathname();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState(null);

  async function syncNow() {
    setSyncing(true);
    try {
      const r = await fetch('/api/sync', { method: 'POST' });
      const j = await r.json();
      setMsg(j.ok ? `Synced — ${j.added} new, ${j.total} rows` : `Sync failed: ${j.error}`);
      if (j.ok) setTimeout(() => location.reload(), 600);
    } catch (e) {
      setMsg(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setMsg(null), 4000);
    }
  }

  return (
    <nav className="nav">
      <Link href="/" className="brand">₹ Finance</Link>
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={`link ${path === href ? 'active' : ''}`}>{label}</Link>
      ))}
      <span className="spacer" />
      <button className="ghost small" onClick={syncNow} disabled={syncing}>
        {syncing ? 'Syncing…' : '⟳ Sync now'}
      </button>
      {msg && <div className="toast">{msg}</div>}
    </nav>
  );
}
