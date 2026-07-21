'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

/* ---- tiny stroke icons (16/24 grid, currentColor) ---- */
const I = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></svg>,
  networth: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-5 4 4 8-8" /><path d="M14 8h6v6" /></svg>,
  insights: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4" /><path d="m5 5 2.8 2.8" /><path d="M2 12h4" /><path d="m19 5-2.8 2.8" /><path d="M22 12h-4" /><path d="M8.5 20a3.5 3.5 0 1 1 7 0z" /><path d="M12 13v3" /></svg>,
  expenses: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18" /><path d="M7 14h4" /></svg>,
  tx: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h13" /><path d="m14 4 3 3-3 3" /><path d="M20 17H7" /><path d="m10 14-3 3 3 3" /></svg>,
  charts: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>,
  explore: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  forecast: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9" /><path d="M3 5v4h4" /><path d="M12 7v5l3 3" /></svg>,
  budgets: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 3v9l6.5 3.5" /></svg>,
  recurring: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 3v5h-5" /></svg>,
  emi: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>,
  balances: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M16 12h5" /><circle cx="16" cy="12" r="0.5" /></svg>,
  income: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" /></svg>,
  credit: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5" /><path d="M21 3 13 11" /><path d="M8 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>,
  savings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M19 10c1 0 2 .9 2 2v2h-2.2a7 7 0 0 1-2.3 3.2V20h-3v-1.5h-3V20h-3v-2.8C5.6 15.9 4.5 14 4.5 12A7.5 7.5 0 0 1 12 4.5c3.5 0 6.4 2.3 7 5.5z" /><circle cx="15" cy="11" r="0.5" /></svg>,
  freelance: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="3" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></svg>,
  cards: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" /></svg>,
  backup: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m17 10-5 5-5-5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>,
  more: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>,
  sun: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
  sync: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 3v5h-5" /></svg>,
};

const GROUPS = [
  { label: 'Overview', items: [
    ['/', 'Statements', 'home'],
    ['/networth', 'Net Worth', 'networth'],
    ['/insights', 'Insights', 'insights'],
  ]},
  { label: 'Spending', items: [
    ['/detailed', 'Expenses', 'expenses'],
    ['/transactions', 'Transactions', 'tx'],
    ['/charts', 'Charts', 'charts'],
    ['/explore', 'Explore', 'explore'],
    ['/search', 'Search', 'search'],
  ]},
  { label: 'Planning', items: [
    ['/forecast', 'Forecast', 'forecast'],
    ['/budgets', 'Budgets', 'budgets'],
    ['/recurring', 'Recurring', 'recurring'],
    ['/emi', 'EMIs', 'emi'],
  ]},
  { label: 'Money', items: [
    ['/balances', 'Balances', 'balances'],
    ['/income', 'Income', 'income'],
    ['/credit', 'Credit Given', 'credit'],
    ['/savings', 'Savings', 'savings'],
    ['/freelance', 'Freelance', 'freelance'],
  ]},
  { label: 'Manage', items: [
    ['/cards', 'Card Settings', 'cards'],
    ['/backup', 'Backup', 'backup'],
  ]},
];

const TABS = [
  ['/', 'Home', 'home'],
  ['/detailed', 'Expenses', 'expenses'],
  ['/transactions', 'Activity', 'tx'],
  ['/balances', 'Balances', 'balances'],
];

export default function Nav() {
  const path = usePathname();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    const saved = document.cookie.match(/(?:^|; )theme=(light|dark)/);
    const t = saved ? saved[1] : 'dark';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  useEffect(() => { setSheet(false); }, [path]);

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
      setMsg(j.ok ? `Synced — ${j.total} rows` : `Sync failed: ${j.error}`);
      if (j.ok) setTimeout(() => location.reload(), 600);
    } catch (e) {
      setMsg(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setMsg(null), 4000);
    }
  }

  const themeBtn = (
    <button className="ghost small" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
      <span className="navic" style={{ verticalAlign: '-3px' }}>{theme === 'dark' ? I.sun : I.moon}</span>
    </button>
  );
  const syncBtn = (
    <button className="ghost small" onClick={syncNow} disabled={syncing} title="Refresh from database">
      <span className="navic" style={{ verticalAlign: '-3px', marginRight: 5 }}>{I.sync}</span>
      {syncing ? 'Syncing…' : 'Sync'}
    </button>
  );

  const tabPaths = TABS.map(([h]) => h);
  const moreActive = !tabPaths.includes(path);

  return (
    <>
      {/* ---------- desktop sidebar ---------- */}
      <aside className="sidebar">
        <Link href="/" className="brand"><span className="brandmark">₹</span> Finance</Link>
        {GROUPS.map((g) => (
          <div className="navgroup" key={g.label}>
            <div className="grouplabel">{g.label}</div>
            {g.items.map(([href, label, ic]) => (
              <Link key={href} href={href} className={`navitem ${path === href ? 'active' : ''}`}>
                <span className="navic">{I[ic]}</span>{label}
              </Link>
            ))}
          </div>
        ))}
        <div className="sidefoot">{themeBtn}{syncBtn}</div>
      </aside>

      {/* ---------- mobile header ---------- */}
      <header className="mobilehead">
        <Link href="/" className="brand"><span className="brandmark">₹</span> Finance</Link>
        <span className="spacer" />
        {themeBtn}
        {syncBtn}
      </header>

      {/* ---------- mobile bottom tabs ---------- */}
      <nav className="tabbar">
        {TABS.map(([href, label, ic]) => (
          <Link key={href} href={href} className={path === href ? 'active' : ''}>
            <span className="navic">{I[ic]}</span>{label}
          </Link>
        ))}
        <button type="button" className={`tab ${moreActive ? 'active' : ''}`} onClick={() => setSheet(true)}
          style={moreActive ? { color: 'var(--accent)' } : undefined}>
          <span className="navic">{I.more}</span>More
        </button>
      </nav>

      {/* ---------- mobile "More" sheet ---------- */}
      {sheet && (
        <>
          <div className="sheetOverlay" onClick={() => setSheet(false)} />
          <div className="sheet">
            <div className="grab" />
            <div className="sheetgrid">
              {GROUPS.flatMap((g) => g.items).map(([href, label, ic]) => (
                <Link key={href} href={href} className={path === href ? 'active' : ''} onClick={() => setSheet(false)}>
                  <span className="navic">{I[ic]}</span>{label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      {msg && <div className="toast">{msg}</div>}
    </>
  );
}
