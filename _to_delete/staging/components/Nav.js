'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

const LINKS = [
  ['/', 'Statements'],
  ['/networth', 'Net Worth'],
  ['/forecast', 'Forecast'],
  ['/budgets', 'Budgets'],
  ['/charts', 'Charts'],
  ['/explore', 'Explore'],
  ['/balances', 'Balances'],
  ['/detailed', 'Expenses'],
  ['/income', 'Income'],
  ['/credit', 'Credit'],
  ['/emi', 'EMIs'],
  ['/recurring', 'Recurring'],
  ['/savings', 'Savings'],
  ['/freelance', 'Freelance'],
  ['/insights', 'Insights'],
  ['/transactions', 'Transactions'],
  ['/search', 'Search'],
  ['/backup', 'Backup'],
  ['/cards', 'Cards'],
];

export default function Nav() {
  const path = usePathname();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState(null);
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    const saved = document.cookie.match(/(?:^|; )theme=(light|dark)/);
    const t = saved ? saved[1] : 'dark';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    document.cookie = `theme=${next}; path=/; max-age=${60 * 60 * 24 * 365}`;
  }

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
      <button className="ghost small" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button className="ghost small" onClick={syncNow} disabled={syncing}>
        {syncing ? 'Syncing…' : '⟳ Sync now'}
      </button>
      {msg && <div className="toast">{msg}</div>}
    </nav>
  );
}
