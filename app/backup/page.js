'use client';
import { useEffect, useState } from 'react';

const TABLES = ['transactions', 'income', 'cards', 'accounts', 'credit_status', 'holdings', 'invoices', 'settings', 'annotations', 'events'];

export default function BackupPage() {
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/export?format=json');
        const j = await r.json();
        setCounts(j.counts || null);
      } catch { /* ignore */ }
    })();
  }, []);

  return (
    <>
      <h1>Backup & Export</h1>
      <div className="panel">
        <h2>Full backup</h2>
        <p className="muted small">A complete JSON snapshot of the app&apos;s data (transactions cache, verify flags, settings, holdings, invoices…). The Google Sheet stays your source of truth; this is a convenience backup.</p>
        <a className="btn" href="/api/export?format=json" download>Download JSON backup</a>
      </div>
      <div className="panel">
        <h2>Export a table as CSV</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {TABLES.map((t) => (
            <a key={t} className="btn ghost small" href={`/api/export?format=csv&table=${t}`} download>
              {t}{counts && counts[t] != null ? ` (${counts[t]})` : ''}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
