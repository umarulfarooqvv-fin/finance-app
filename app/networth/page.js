'use client';
import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { inr, inr0 } from '@/components/format';

export default function NetWorthPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/networth');
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        setData(j);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, []);

  if (error) return <div className="panel">Failed: {error}</div>;
  if (!data) return <div className="panel muted">Loading net worth…</div>;

  const { snapshot, trend } = data;
  const a = snapshot.assets;

  return (
    <>
      <h1>Net Worth</h1>

      <div className="panel" style={{ borderColor: 'var(--accent)' }}>
        <div className="label">Net worth today</div>
        <div
          className="value accent"
          style={{
            fontSize: 30,
            fontWeight: 800,
            margin: '4px 0',
            color: snapshot.netWorth < 0 ? 'var(--red)' : 'var(--green)',
          }}
        >
          {inr(snapshot.netWorth)}
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Assets {inr0(snapshot.totalAssets)} − liabilities {inr0(snapshot.totalLiabilities)} (card
          debt {inr0(snapshot.liabilities.cardDebt)} + borrowed{' '}
          {inr0(snapshot.liabilities.creditTakenOutstanding)})
        </p>
      </div>

      <div className="kpis">
        <Kpi label="Bank balances" value={inr(a.bank)} />
        <Kpi label="Savings" value={inr(a.savings)} />
        <Kpi label="Investments" value={inr(a.investments)} />
        <Kpi label="Credit given (owed to you)" value={inr(a.creditGivenOutstanding)} />
        <Kpi label="Card debt" value={inr(snapshot.liabilities.cardDebt)} cls="red" />
        <Kpi
          label="Credit taken (you owe)"
          value={inr(snapshot.liabilities.creditTakenOutstanding)}
          cls="red"
        />
      </div>

      <div className="panel">
        <h2>Trend</h2>
        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#2a3342" strokeDasharray="3 3" />
              <XAxis dataKey="month" stroke="#8b97a8" fontSize={11} />
              <YAxis
                stroke="#8b97a8"
                fontSize={11}
                tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                width={44}
              />
              <Tooltip
                contentStyle={{
                  background: '#161b23',
                  border: '1px solid #2a3342',
                  borderRadius: 8,
                }}
                formatter={(v) => inr(v)}
              />
              <Line
                type="monotone"
                dataKey="netWorth"
                stroke="#5b8cff"
                strokeWidth={2.5}
                dot={false}
                name="Net worth"
              />
              <Line
                type="monotone"
                dataKey="bank"
                stroke="#34d399"
                strokeWidth={1.5}
                dot={false}
                name="Bank"
              />
              <Line
                type="monotone"
                dataKey="cardDebt"
                stroke="#f87171"
                strokeWidth={1.5}
                dot={false}
                name="Card debt"
              />
              <Line
                type="monotone"
                dataKey="creditTakenOutstanding"
                stroke="#fbbf24"
                strokeWidth={1.5}
                dot={false}
                name="Borrowed"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="muted small">
          Trend is reconstructed from transaction history at each month-end. Savings & investments
          have no history, so they&apos;re carried flat at today&apos;s value (
          {inr0(data.trend.length ? snapshot.assets.savings + snapshot.assets.investments : 0)}).
        </p>
      </div>
    </>
  );
}

function Kpi({ label, value, cls = '' }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value ${cls}`}>{value}</div>
    </div>
  );
}
