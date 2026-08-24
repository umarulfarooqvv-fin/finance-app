import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSnapshot } from '@/lib/snapshot';
import { cardColor, cardDetail, type LedgerEntry } from '@/lib/statement';
import { dayOf, formatDay, formatDayShort, relativeDays } from '@/lib/time';
import { money, percent } from '@/lib/format';
import { Page, PageHeader } from '@/components/layout/page-header';
import {
  Badge, Dot, Empty, Meter, Money, Panel, SectionTitle, Stat, StatGrid, TableWrap, Td, Th,
} from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   One card in full (spec §3.3): the bill, the balance still building, the
   cycle arithmetic written out, and the reconciliation split.
   =========================================================================== */

function Ledger({ entries, empty }: { entries: LedgerEntry[]; empty: string }) {
  if (entries.length === 0) return <Empty title={empty} />;

  return (
    <TableWrap>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Description</Th>
          <Th>Category</Th>
          <Th align="right">Debit</Th>
          <Th align="right">Credit</Th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <Td className="whitespace-nowrap text-xs text-[var(--color-ink-2)]">
              {formatDayShort(e.day)}
            </Td>
            <Td>
              <span className="flex items-center gap-2">
                <span className="truncate">{e.description}</span>
                {e.verified ? (
                  <span
                    className="text-[var(--color-pos)]"
                    title="Matched against the bank statement"
                    aria-label="Verified"
                  >
                    ✓
                  </span>
                ) : null}
              </span>
            </Td>
            <Td className="text-xs text-[var(--color-ink-3)]">{e.category}</Td>
            <Td align="right">{e.debit ? <Money value={e.debit} size="sm" /> : null}</Td>
            <Td align="right">
              {e.credit ? <Money value={e.credit} size="sm" tone="credit" /> : null}
            </Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export default async function CardPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const cardName = decodeURIComponent(name);

  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);
  const card = snap.cards.find((c) => c.name === cardName);
  if (!card) notFound();

  const { row, billed, unbilled } = cardDetail(snap, card, today);
  const m = row.cycleMath;
  const checked = row.verified.verified + row.verified.unverified;

  return (
    <Page>
      <PageHeader
        title={card.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Bills on the {card.billDate}{ordinal(card.billDate)} · statement {formatDay(row.cycle.statementEnd)}</span>
          </span>
        }
        action={
          <Link
            href="/cards"
            className="rounded-[var(--radius-field)] border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-line-strong)]"
          >
            All cards
          </Link>
        }
      />

      <Panel>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
              <Dot color={cardColor(card.slot)} />
              Total balance now
            </div>
            <Money value={row.totalDebtLive} size="display" className="mt-1 block" />
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              {row.remainingDueBill > 0 ? (
                <>
                  <strong className="sensitive font-semibold text-[var(--color-ink)]">
                    {money(row.remainingDueBill)}
                  </strong>{' '}
                  due {formatDay(row.cycle.dueDate)} · {relativeDays(row.daysLeft)}
                </>
              ) : (
                <>Bill cleared. Next statement {formatDay(row.cycle.nextStatementEnd)}.</>
              )}
            </p>
          </div>
          {row.status === 'overdue' ? (
            <Badge tone="bad">Overdue</Badge>
          ) : row.status === 'due-soon' ? (
            <Badge tone="warn">{row.daysLeft === 0 ? 'Due today' : `${row.daysLeft}d left`}</Badge>
          ) : row.status === 'paid' ? (
            <Badge tone="good">Paid</Badge>
          ) : (
            <Badge tone="neutral">On track</Badge>
          )}
        </div>

        <div className="mt-5 border-t border-[var(--color-line)] pt-4">
          <StatGrid cols={4}>
            <Stat label="On this bill" value={row.remainingDueBill} />
            <Stat label="Unbilled since" value={row.unbilled} />
            <Stat
              label="Utilisation"
              value={row.totalDebtLive <= 0 ? 'Nothing owed' : percent(row.utilization)}
              hint={
                card.creditLimit > 0 ? (
                  <>of <span className="sensitive">{money(card.creditLimit, { whole: true })}</span></>
                ) : (
                  'No limit set'
                )
              }
            />
            <Stat
              label="Lent to others"
              value={row.creditGivenOutstanding}
              hint="Still unpaid, excluded from your own debt"
              tone="muted"
            />
          </StatGrid>
          <div className="mt-3">
            <Meter value={row.utilization} label={`${card.name} utilisation`} />
          </div>
        </div>
      </Panel>

      {/* ---- Cycle arithmetic, written out ------------------------------- */}
      <Panel className="mt-4">
        <SectionTitle>How this bill was built</SectionTitle>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
          <span className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-2.5 py-1.5">
            <span className="text-[11px] text-[var(--color-ink-3)]">Opening </span>
            <Money value={m.openingBalance} size="sm" />
          </span>
          <span className="text-[var(--color-ink-3)]">+</span>
          <span className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-2.5 py-1.5">
            <span className="text-[11px] text-[var(--color-ink-3)]">Spends </span>
            <Money value={m.cycleSpends} size="sm" />
          </span>
          <span className="text-[var(--color-ink-3)]">−</span>
          <span className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-2.5 py-1.5">
            <span className="text-[11px] text-[var(--color-ink-3)]">Payments </span>
            <Money value={m.cycleRepayments} size="sm" />
          </span>
          <span className="text-[var(--color-ink-3)]">=</span>
          <span className="rounded-[var(--radius-field)] bg-[var(--color-accent-soft)] px-2.5 py-1.5">
            <span className="text-[11px] text-[var(--color-accent)]">Closing </span>
            <Money value={m.closingBalance} size="sm" className="font-semibold" />
          </span>
        </div>
        <p className="mt-3 text-xs text-[var(--color-ink-3)]">
          Cycle ran {formatDay(row.cycle.cycleStart)} to {formatDay(row.cycle.statementEnd)}.
        </p>
      </Panel>

      {/* ---- Reconciliation ---------------------------------------------- */}
      <Panel className="mt-4">
        <SectionTitle>Reconciliation</SectionTitle>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex h-2 overflow-hidden rounded-full bg-[var(--color-raised)]">
              <div
                className="bg-[var(--color-pos)]"
                style={{ width: checked > 0 ? `${(row.verified.verified / checked) * 100}%` : '0%' }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs">
              <span className="text-[var(--color-pos)]">
                <span className="sensitive">{money(row.verified.verified)}</span> verified
              </span>
              <span className="text-[var(--color-ink-3)]">
                <span className="sensitive">{money(row.verified.unverified)}</span> unchecked
              </span>
            </div>
          </div>
        </div>
      </Panel>

      {/* ---- Ledgers ------------------------------------------------------ */}
      <Panel className="mt-4">
        <SectionTitle>
          Still building · <span className="sensitive">{money(row.unbilled)}</span>
        </SectionTitle>
        <Ledger entries={unbilled} empty="Bill cleared. No new spends yet." />
      </Panel>

      <Panel className="mt-4">
        <SectionTitle>On the {formatDay(row.cycle.statementEnd)} statement</SectionTitle>
        <Ledger entries={billed} empty="Nothing was billed in this cycle." />
      </Panel>
    </Page>
  );
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}
