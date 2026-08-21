import Link from 'next/link';
import { getSnapshot } from '../../data/snapshot.ts';
import { incomeBetween } from '../../domain/analytics.ts';
import { accountBalances, netWorth } from '../../domain/balances.ts';
import { dayOf, formatDay, monthKey, monthStart } from '../../domain/time.ts';
import { Page, PageHeader } from '../../ui/PageHeader.tsx';
import {
  Empty, Money, Panel, SectionTitle, Stat, StatGrid, TableWrap, Td, Th,
} from '../../ui/primitives.tsx';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Money — what you actually hold.

   Absorbs v2's /balances, /networth, /savings and /income.
   =========================================================================== */

export default async function MoneyPage() {
  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);

  const nw = netWorth(snap, today);
  const accounts = accountBalances(snap, today);
  const monthIncome = incomeBetween(snap, monthStart(monthKey(today)), today);

  const recentIncome = snap.income
    .filter((i) => !i.deleted && i.ts && i.amount != null)
    .sort((a, b) => (a.ts! < b.ts! ? 1 : -1))
    .slice(0, 10);

  const unconfigured = accounts.every((a) => a.openingBalance === 0 && a.since === null);

  return (
    <Page>
      <PageHeader title="Money" subtitle={`Position as of ${formatDay(today)}`} />

      <Panel>
        <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
          Net worth
        </div>
        <Money value={nw.net} size="display" tone="auto" className="mt-1 block" />

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2.5">
            <div className="text-[11px] text-[var(--color-ink-3)]">In accounts</div>
            <Money value={nw.liquid} size="md" className="mt-0.5 block font-semibold" />
          </div>
          <div className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2.5">
            <div className="text-[11px] text-[var(--color-ink-3)]">Owed to you</div>
            <Money value={nw.owedToYou} size="md" tone="credit" className="mt-0.5 block font-semibold" />
          </div>
          <div className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2.5">
            <div className="text-[11px] text-[var(--color-ink-3)]">Card debt</div>
            <Money value={nw.cardDebt} size="md" tone="debt" className="mt-0.5 block font-semibold" />
          </div>
          <div className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2.5">
            <div className="text-[11px] text-[var(--color-ink-3)]">Borrowed</div>
            <Money value={nw.borrowed} size="md" tone="debt" className="mt-0.5 block font-semibold" />
          </div>
        </div>
      </Panel>

      <Panel className="mt-4">
        <SectionTitle
          action={
            <Link href="/settings" className="text-xs font-medium text-[var(--color-accent)]">
              Configure
            </Link>
          }
        >
          Accounts
        </SectionTitle>

        {unconfigured ? (
          <Empty
            title="Account balances are not set up"
            hint="These are reconstructed from an opening balance on a chosen date plus income minus outflows — the app has no bank connection. Set an opening balance and date to make them meaningful."
          />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th>Tracked since</Th>
                  <Th align="right">Opening</Th>
                  <Th align="right">In</Th>
                  <Th align="right">Out</Th>
                  <Th align="right">Balance</Th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.name}>
                    <Td className="font-medium">{a.name}</Td>
                    <Td className="whitespace-nowrap text-xs text-[var(--color-ink-2)]">
                      {a.since ? formatDay(a.since) : 'All history'}
                    </Td>
                    <Td align="right">
                      <Money value={a.openingBalance} size="sm" tone="muted" />
                    </Td>
                    <Td align="right">
                      <Money value={a.incomeIn} size="sm" tone="credit" />
                    </Td>
                    <Td align="right">
                      <Money value={a.paidOut} size="sm" tone="muted" />
                    </Td>
                    <Td align="right">
                      <Money value={a.balance} size="sm" tone="auto" className="font-semibold" />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
              Derived figures, not bank balances: opening balance plus logged income, minus
              everything logged as paid from that account. Accurate only as far as the logging is.
            </p>
          </>
        )}
      </Panel>

      <Panel className="mt-4">
        <SectionTitle>Income</SectionTitle>
        <StatGrid cols={2}>
          <Stat label="This month" value={monthIncome} tone="credit" />
          <Stat label="Records" value={String(snap.income.length)} hint="income entries in total" />
        </StatGrid>

        {recentIncome.length === 0 ? (
          <div className="mt-3">
            <Empty title="No income recorded" />
          </div>
        ) : (
          <ul className="mt-4 flex flex-col">
            {recentIncome.map((i) => (
              <li
                key={i.id}
                className="flex items-center gap-3 border-b border-[var(--color-line)] py-2.5 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{i.source || 'Income'}</div>
                  <div className="text-[11px] text-[var(--color-ink-3)]">
                    {i.ts ? formatDay(i.ts.slice(0, 10)) : '—'}
                    {i.account ? ` · ${i.account}` : ''}
                    {i.remarks ? ` · ${i.remarks}` : ''}
                  </div>
                </div>
                <Money value={i.amount} size="md" tone="credit" className="shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="mt-4 text-center text-[11px] text-[var(--color-ink-3)]">
        Savings and investment holdings are not counted in net worth yet. v2 carried a manually
        entered figure flat between updates, which showed a rising line during months when nothing
        had actually changed.
      </p>
    </Page>
  );
}
