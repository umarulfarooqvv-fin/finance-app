import { getSnapshot } from '@/lib/snapshot';
import { creditLedger } from '@/lib/credit';
import { recovery, STALE_DAYS } from '@/lib/recovery';
import { SettleButton } from './settle-button';
import { debtLedger } from '@/lib/debts';
import { emiPlans, emiSummary } from '@/lib/emi';
import { dayOf, formatDay } from '@/lib/time';
import { money } from '@/lib/format';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Private } from '@/contexts/privacy-context';
import {
  Badge, Empty, Money, Panel, SectionTitle, Stat, StatGrid, TableWrap, Td, Th,
} from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Ledgers — everything that is not a bank or a card.

   Three questions on one page: who owes me, who do I owe, and what is on
   instalments. v2 spread these across /credit, /credit-taken, /emi and
   /recurring; they are all the same question about obligations over time.
   =========================================================================== */

export default async function LedgersPage() {
  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);
  const rec = recovery(snap, today);

  const credit = creditLedger(snap);
  const debts = debtLedger(snap);
  const plans = emiPlans(snap, today);
  const emi = emiSummary(plans);

  const owedToMe = credit.people.filter((p) => !p.settled);
  const activePlans = plans.filter((p) => !p.complete);

  return (
    <Page>
      <PageHeader title="Ledgers" subtitle="Money lent, money borrowed, and instalment plans" />

      <Panel>
        <StatGrid cols={3}>
          <Stat
            label="Owed to you"
            value={credit.totalOutstanding}
            tone="credit"
            hint={`${owedToMe.length} people`}
          />
          <Stat
            label="You owe people"
            value={debts.totalOutstanding}
            tone="debt"
            hint={debts.debts.length ? `${debts.debts.filter((d) => !d.settled).length} open` : 'None recorded'}
          />
          <Stat
            label="EMIs each month"
            value={emi.monthlyOutgo}
            hint={
              <>
                {emi.activeCount} active ·{' '}
                <span className="sensitive">{money(emi.remainingTotal)}</span> left
              </>
            }
          />
        </StatGrid>
      </Panel>

      {/* ---- Credit given ------------------------------------------------- */}
      {/* ---- What is going cold ----------------------------------------
           The table below says who owes what. It cannot say which of those
           balances is DRIFTING — and a small one untouched since winter is
           the one that becomes money nobody mentions again. */}
      {rec.people.length > 0 ? (
        <Panel className="mt-4">
          <SectionTitle>Worth chasing &middot; {rec.people.length}</SectionTitle>
          <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Not recorded back" value={rec.outstanding} tone="debt" />
            <Stat
              label={`Quiet ${STALE_DAYS}+ days`}
              value={rec.stale}
              tone={rec.stale > 0.005 ? 'debt' : 'credit'}
              hint={`${rec.staleCount} of ${rec.people.length}`}
            />
            <Stat
              label="Matched nobody"
              value={rec.unattached.amount}
              tone={rec.unattached.count > 0 ? 'debt' : 'muted'}
              hint={rec.unattached.count > 0 ? `${rec.unattached.count} repayments` : 'none'}
            />
          </div>

          <ul className="flex flex-col">
            {rec.people.slice(0, 8).map((p) => (
              <li
                key={p.person}
                className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  <Private>{p.person}</Private>
                </span>
                <Badge tone={p.flag === 'moving' ? 'good' : 'warn'}>
                  {p.flag === 'nothing-back'
                    ? 'nothing back'
                    : p.flag === 'stalled'
                      ? `quiet ${p.quietFor}d`
                      : 'repaying'}
                </Badge>
                <span className="shrink-0 text-[11px] text-[var(--color-ink-3)]">
                  {Math.round(p.recovered * 100)}% back &middot; oldest {p.oldestAge}d
                </span>
                <Money value={p.outstanding} size="sm" tone="debt" className="font-semibold" />
                <SettleButton person={p.person} outstanding={p.outstanding} />
              </li>
            ))}
          </ul>

          <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
            The ones that have gone quiet come first, largest of those at the top &mdash; sorting
            by amount alone puts a healthily-repaying arrangement first, and sorting by silence
            alone brings up trivial sums untouched for years. Every figure means{' '}
            <em>not recorded as repaid</em>: cash handed back without being logged still reads as
            outstanding here.
          </p>
        </Panel>
      ) : null}

      <Panel className="mt-4">
        <SectionTitle>Owed to you</SectionTitle>

        {owedToMe.length === 0 ? (
          <Empty
            title="Nothing outstanding"
            hint="Rows with the Credit Given category appear here, grouped by person."
          />
        ) : (
          <>
            <TableWrap stickyFirst>
              <thead>
                <tr>
                  <Th sticky>Person</Th>
                  <Th align="right">Lent</Th>
                  <Th align="right">Came back</Th>
                  <Th align="right">Outstanding</Th>
                  <Th>Last activity</Th>
                </tr>
              </thead>
              <tbody>
                {owedToMe.slice(0, 25).map((p) => (
                  <tr key={p.person}>
                    <Td sticky className="font-medium">
                      {/* A list of who owes you money is exactly what you do
                          not want visible over your shoulder. */}
                      <Private>{p.person}</Private>
                    </Td>
                    <Td align="right">
                      <Money value={p.given} size="sm" tone="muted" />
                    </Td>
                    <Td align="right">
                      <Money value={p.repaid} size="sm" tone="credit" />
                    </Td>
                    <Td align="right">
                      <Money value={p.outstanding} size="sm" className="font-semibold" />
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-[var(--color-ink-3)]">
                      {p.lastActivity ? formatDay(p.lastActivity.slice(0, 10)) : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>

            <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
              Repayments are matched oldest-lending-first, and are only known when they were
              recorded as income or as a Credit Return row. Cash handed back without being logged
              still reads as outstanding here — treat a large balance as{' '}
              <em>not recorded as repaid</em> rather than as certainly unpaid.
            </p>
          </>
        )}
      </Panel>

      {/* ---- Credit taken ------------------------------------------------- */}
      <Panel className="mt-4">
        <SectionTitle>You owe</SectionTitle>

        {debts.debts.length === 0 ? (
          <Empty
            title="No borrowings recorded"
            hint="Nothing in the transaction log marks a borrowing — money arriving as a loan looks like any other inflow — so these are entered by hand."
          />
        ) : (
          <TableWrap stickyFirst>
            <thead>
              <tr>
                <Th sticky>Person</Th>
                <Th>Taken</Th>
                <Th align="right">Principal</Th>
                <Th align="right">Repaid</Th>
                <Th align="right">Balance</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {debts.debts.map((d) => (
                <tr key={d.id}>
                  <Td sticky className="font-medium">
                    <Private>{d.person}</Private>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-[var(--color-ink-2)]">
                    {formatDay(d.takenOn)}
                  </Td>
                  <Td align="right">
                    <Money value={d.principal} size="sm" tone="muted" />
                  </Td>
                  <Td align="right">
                    <Money value={d.repaid} size="sm" tone="credit" />
                  </Td>
                  <Td align="right">
                    <Money value={d.balance} size="sm" className="font-semibold" />
                  </Td>
                  <Td>
                    {d.settled ? <Badge tone="good">Settled</Badge> : <Badge tone="warn">Open</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {/* ---- EMIs --------------------------------------------------------- */}
      <Panel className="mt-4">
        <SectionTitle>Instalment plans</SectionTitle>

        {activePlans.length === 0 ? (
          <Empty
            title="No active plans"
            hint="Plans are detected from an n/m counter in the remarks, e.g. “Ipad Mini 18/24”."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {activePlans.map((p) => (
              <div
                key={`${p.name}-${p.months}`}
                className="rounded-[var(--radius-field)] border border-[var(--color-line)] p-3.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="text-sm font-semibold">{p.name}</span>
                    {p.card ? (
                      <span className="ml-2 text-xs text-[var(--color-ink-3)]">on {p.card}</span>
                    ) : null}
                  </div>
                  <Money value={p.instalmentAmount} size="md" className="font-semibold" />
                </div>

                <div className="mt-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
                  {Array.from({ length: p.months }, (_, i) => (
                    <span
                      key={i}
                      className={
                        i < p.paidCount
                          ? 'flex-1 bg-[var(--color-accent)]'
                          : 'flex-1 bg-[var(--color-raised)]'
                      }
                    />
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] text-[var(--color-ink-3)]">
                  <span>
                    {p.paidCount} of {p.months} paid ·{' '}
                    <span className="sensitive">{money(p.paidAmount)}</span> so far
                  </span>
                  <span>
                    <span className="sensitive">{money(p.remainingAmount)}</span> left
                    {p.nextDue ? ` · next ${formatDay(p.nextDue)}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {plans.some((p) => p.complete) ? (
          <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
            {plans.filter((p) => p.complete).length} completed{' '}
            {plans.filter((p) => p.complete).length === 1 ? 'plan' : 'plans'} hidden.
          </p>
        ) : null}
      </Panel>
    </Page>
  );
}
