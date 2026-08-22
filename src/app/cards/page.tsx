import Link from 'next/link';
import { cardsView, currentSnapshot } from '@/lib/views';
import type { StatementRow } from '@/lib/statement';
import { formatDay, relativeDays } from '@/lib/time';
import { money, percent } from '@/lib/format';
import { Page, PageHeader } from '@/components/layout/page-header';
import {
  Badge, Dot, Empty, Meter, Money, Panel, Stat, StatGrid, TableWrap, Td, Th,
} from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Cards — the Statement View (spec §3.2).

   This is the one screen that stays a table, because comparing six cards
   column by column is exactly what a table is for. It keeps the sheet's full
   column set, with the totals row the sheet computed in its header.
   =========================================================================== */

function StatusCell({ row }: { row: StatementRow }) {
  if (row.status === 'overdue') return <Badge tone="bad">Overdue</Badge>;
  if (row.status === 'due-soon') {
    return <Badge tone="warn">{row.daysLeft === 0 ? 'Due today' : `${row.daysLeft}d left`}</Badge>;
  }
  if (row.status === 'paid') return <Badge tone="good">Paid</Badge>;
  return <Badge tone="neutral">{relativeDays(row.daysLeft)}</Badge>;
}

export default async function CardsPage() {
  const { today } = await currentSnapshot();
  const { rows, totals } = await cardsView();

  return (
    <Page>
      <PageHeader
        title="Cards"
        subtitle={`Statement view as of ${formatDay(today)}`}
        action={
          <Link
            href="/settings"
            className="rounded-[var(--radius-field)] border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-line-strong)]"
          >
            Settings
          </Link>
        }
      />

      <Panel>
        <StatGrid cols={4}>
          <Stat label="Total debt (live)" value={totals.totalDebtLive} />
          <Stat label="Due on bills" value={totals.remainingDueBill} />
          <Stat label="Unbilled" value={totals.unbilled} />
          <Stat
            label="Utilisation"
            value={percent(totals.utilization)}
            hint={`of ${money(totals.limits, { whole: true })} limits`}
          />
        </StatGrid>

        <div className="mt-4 border-t border-[var(--color-line)] pt-4">
          <StatGrid cols={2}>
            <Stat
              label="Debt excluding credit given"
              value={totals.totalDebtExcl}
              hint="Money you lent that has not come back is not really your spending"
            />
            <Stat label="Bills excluding credit given" value={totals.remainingDueExcl} />
          </StatGrid>
        </div>
      </Panel>

      <Panel className="mt-4" padded={false}>
        {rows.length === 0 ? (
          <Empty title="No active cards" hint="Add a card in settings to start tracking statements." />
        ) : (
          <div className="p-4 sm:p-5">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Card</Th>
                  <Th>Statement</Th>
                  <Th>Due</Th>
                  <Th align="right">Bill due</Th>
                  <Th align="right">Unbilled</Th>
                  <Th align="right">Total (live)</Th>
                  <Th align="right">Excl. credit</Th>
                  <Th>Utilisation</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.card} className="transition-colors hover:bg-[var(--color-raised)]">
                    <Td>
                      <Link
                        href={`/cards/${encodeURIComponent(row.card)}`}
                        className="flex items-center gap-2 font-medium"
                      >
                        <Dot color={row.color} />
                        {row.card}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-[var(--color-ink-2)]">
                      {formatDay(row.cycle.statementEnd)}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-[var(--color-ink-2)]">
                      {formatDay(row.cycle.dueDate)}
                    </Td>
                    <Td align="right">
                      <Money value={row.remainingDueBill} size="sm" />
                    </Td>
                    <Td align="right">
                      <Money value={row.unbilled} size="sm" tone="muted" />
                    </Td>
                    <Td align="right">
                      <Money value={row.totalDebtLive} size="sm" className="font-semibold" />
                    </Td>
                    <Td align="right">
                      <Money value={row.totalDebtExcl} size="sm" tone="muted" />
                    </Td>
                    <Td>
                      <div className="w-24">
                        <Meter value={row.utilization} label={`${row.card} utilisation`} />
                      </div>
                    </Td>
                    <Td>
                      <StatusCell row={row} />
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <Td>Total</Td>
                  <Td />
                  <Td />
                  <Td align="right">
                    <Money value={totals.remainingDueBill} size="sm" className="font-semibold" />
                  </Td>
                  <Td align="right">
                    <Money value={totals.unbilled} size="sm" className="font-semibold" />
                  </Td>
                  <Td align="right">
                    <Money value={totals.totalDebtLive} size="sm" className="font-semibold" />
                  </Td>
                  <Td align="right">
                    <Money value={totals.totalDebtExcl} size="sm" className="font-semibold" />
                  </Td>
                  <Td colSpan={2} />
                </tr>
              </tfoot>
            </TableWrap>
          </div>
        )}
      </Panel>
    </Page>
  );
}
