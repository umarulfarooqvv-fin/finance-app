import { getSnapshot } from '@/lib/snapshot';
import { cardColor } from '@/lib/statement';
import { formatDay } from '@/lib/time';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Dot, Money, Panel, SectionTitle, TableWrap, Td, Th } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

/* Read-only for now: this shows exactly what the engine is using, which is
   the thing you need when a number looks wrong. Editing writes to app_config
   and is the next piece of work — see HANDOFF.md. */

export default async function SettingsPage() {
  const snap = await getSnapshot();

  return (
    <Page>
      <PageHeader title="Settings" subtitle="The configuration every figure is computed from" />

      <Panel>
        <SectionTitle>Cards</SectionTitle>
        <TableWrap>
          <thead>
            <tr>
              <Th>Card</Th>
              <Th align="right">Bills on</Th>
              <Th align="right">Due</Th>
              <Th align="right">Limit</Th>
              <Th align="right">Opening balance</Th>
              <Th>Tracked from</Th>
            </tr>
          </thead>
          <tbody>
            {snap.cards.map((c) => (
              <tr key={c.name}>
                <Td>
                  <span className="flex items-center gap-2 font-medium">
                    <Dot color={cardColor(c.slot)} />
                    {c.name}
                  </span>
                </Td>
                <Td align="right" className="num text-xs">{c.billDate}</Td>
                <Td align="right" className="num text-xs">
                  {c.dueDay ? `${c.dueDay} (${c.dueCycle} month)` : `+${c.graceDays} days`}
                </Td>
                <Td align="right"><Money value={c.creditLimit} size="sm" tone="muted" /></Td>
                <Td align="right"><Money value={c.openingBalance} size="sm" tone="muted" /></Td>
                <Td className="whitespace-nowrap text-xs text-[var(--color-ink-3)]">
                  {c.openingDate ? formatDay(c.openingDate) : 'All history'}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
          The opening balance stands in for debt carried before tracking began. Rows older than
          the tracked-from date are skipped so that history is not counted twice.
        </p>
      </Panel>

      <Panel className="mt-4">
        <SectionTitle>Data</SectionTitle>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">Transactions</dt>
            <dd className="num mt-0.5 font-semibold">{snap.transactions.length.toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">Income rows</dt>
            <dd className="num mt-0.5 font-semibold">{snap.income.length.toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">Store version</dt>
            <dd className="num mt-0.5 font-semibold">{snap.version}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">Loaded at</dt>
            <dd className="num mt-0.5 text-xs">{snap.loadedAt.replace('T', ' ')}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
          {snap.transactions.filter((t) => t.needsReview).length} rows could not be fully
          classified — usually a blank amount or an unrecognised category.
        </p>
      </Panel>
    </Page>
  );
}
