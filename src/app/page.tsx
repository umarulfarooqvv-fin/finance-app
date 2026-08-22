import Link from 'next/link';
import { cardsView, currentSnapshot, forecastView } from '../data/views.ts';
import { monthSummary, priorWindow, recentActivity } from '../domain/analytics.ts';
import type { StatementRow } from '../domain/statement.ts';
import { formatDay, formatDayShort, relativeDays } from '../domain/time.ts';
import { delta, money, moneyCompact } from '../ui/format.ts';
import { Page, PageHeader } from '../ui/PageHeader.tsx';
import { Badge, Dot, Empty, Meter, Money, Panel, SectionTitle, cx } from '../ui/primitives.tsx';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Today — the home screen.

   The organising idea: answer "am I OK?" before showing a single table.

   v2 opened on a six-row statement grid, which is a reference document, not an
   answer. The first thing here is the one number that decides the day (how
   much to keep in the bank), then anything that actually needs a decision,
   and only then the detail. Nothing on this page is a table.
   =========================================================================== */

function statusBadge(row: StatementRow) {
  if (row.status === 'overdue') return <Badge tone="bad">Overdue</Badge>;
  if (row.status === 'due-soon') {
    return <Badge tone="warn">{row.daysLeft === 0 ? 'Due today' : `Due in ${row.daysLeft}d`}</Badge>;
  }
  if (row.status === 'paid') return <Badge tone="good">Paid</Badge>;
  return <Badge tone="neutral">{relativeDays(row.daysLeft)}</Badge>;
}

/**
 * Utilisation only means something when there is debt to measure. An overpaid
 * card produces a small negative ratio, which renders as "-0% used" — noise
 * dressed up as a statistic.
 */
function utilisationLabel(row: StatementRow): string {
  if (row.utilization === null) return 'No limit set';
  if (row.totalDebtLive <= 0) return 'Nothing owed';
  return `${(row.utilization * 100).toFixed(0)}% used`;
}

export default async function TodayPage() {
  const { snap, today } = await currentSnapshot();
  // Both go through the cached selectors: forecast() calls statementView()
  // internally, so without the dedupe the engine would run twice per render.
  const [view, fc] = await Promise.all([cardsView(), forecastView()]);
  const month = monthSummary(snap, today);
  const prior = priorWindow(snap, today);
  const recent = recentActivity(snap, today, 6);

  const needsAction = view.rows.filter((r) => r.status === 'overdue' || r.status === 'due-soon');
  const change = prior.spend > 0 ? (month.spend - prior.spend) / prior.spend : null;
  const empty = snap.transactions.length === 0;

  return (
    <Page>
      <PageHeader
        title="Today"
        subtitle={`${formatDayShort(today)} · ${snap.transactions.length.toLocaleString('en-IN')} transactions tracked`}
      />

      {empty ? (
        <Panel>
          <Empty
            icon="₹"
            title="No data loaded"
            hint="Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local to connect to your Postgres store."
          />
        </Panel>
      ) : null}

      {/* ---- The number that decides the day ------------------------------ */}
      <Panel className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[var(--color-accent-soft)] opacity-50 blur-2xl" />
        <div className="relative">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
            Recommended bank reserve
          </div>
          <div className="mt-1.5">
            <Money value={fc.recommendedReserve} size="display" />
          </div>
          <p className="mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
            Keep at least this much available to cover every card balance plus what you are on
            track to spend over the {fc.daysRemaining} {fc.daysRemaining === 1 ? 'day' : 'days'} left
            this month.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
            <div className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2.5">
              <div className="text-[11px] text-[var(--color-ink-3)]">Card debt now</div>
              <Money value={fc.totalDebtLive} size="md" className="mt-0.5 block font-semibold" />
            </div>
            <div className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2.5">
              <div className="text-[11px] text-[var(--color-ink-3)]">Still to spend</div>
              <Money value={fc.estimatedRemaining} size="md" className="mt-0.5 block font-semibold" />
            </div>
          </div>
        </div>
      </Panel>

      {/* ---- Only rendered when something actually needs doing ------------- */}
      {needsAction.length > 0 ? (
        <section className="mt-6">
          <SectionTitle>Needs attention</SectionTitle>
          <div className="flex flex-col gap-2">
            {needsAction.map((row) => (
              <Link
                key={row.card}
                href={`/cards/${encodeURIComponent(row.card)}`}
                className={cx(
                  'flex items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3 transition-colors',
                  row.status === 'overdue'
                    ? 'border-transparent bg-[var(--color-neg-soft)]'
                    : 'border-transparent bg-[var(--color-warn-soft)]',
                )}
              >
                <Dot color={row.color} size={10} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{row.card}</div>
                  <div className="text-xs text-[var(--color-ink-2)]">
                    {row.status === 'overdue'
                      ? `Was due ${formatDay(row.cycle.dueDate)}`
                      : `Due ${formatDay(row.cycle.dueDate)} · ${relativeDays(row.daysLeft)}`}
                  </div>
                </div>
                <Money
                  value={row.remainingDueBill}
                  size="md"
                  tone={row.status === 'overdue' ? 'debt' : 'neutral'}
                  className="font-semibold"
                />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Cards: a scannable strip, not a spreadsheet ------------------- */}
      <section className="mt-6">
        <SectionTitle
          action={
            <Link href="/cards" className="text-xs font-medium text-[var(--color-accent)]">
              All cards
            </Link>
          }
        >
          Cards
        </SectionTitle>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {view.rows.map((row) => (
            <Link key={row.card} href={`/cards/${encodeURIComponent(row.card)}`}>
              <Panel className="h-full transition-colors hover:border-[var(--color-line-strong)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Dot color={row.color} />
                    <span className="truncate text-sm font-semibold">{row.card}</span>
                  </div>
                  {statusBadge(row)}
                </div>

                <div className="mt-3">
                  <Money value={row.totalDebtLive} size="xl" />
                  <div className="mt-0.5 text-xs text-[var(--color-ink-3)]">
                    {row.remainingDueBill > 0
                      ? `${money(row.remainingDueBill)} on this bill`
                      : 'Bill cleared'}
                    {row.unbilled > 0 ? ` · ${money(row.unbilled)} unbilled` : ''}
                  </div>
                </div>

                <div className="mt-3">
                  <Meter value={row.utilization} label={`${row.card} utilisation`} />
                  <div className="mt-1.5 flex justify-between text-[11px] text-[var(--color-ink-3)]">
                    <span>{utilisationLabel(row)}</span>
                    <span>{row.creditLimit > 0 ? moneyCompact(row.creditLimit) : ''}</span>
                  </div>
                </div>
              </Panel>
            </Link>
          ))}
        </div>
      </section>

      {/* ---- This month --------------------------------------------------- */}
      <section className="mt-6 grid gap-3 lg:grid-cols-2">
        <Panel>
          <SectionTitle
            action={
              <Link href="/spending" className="text-xs font-medium text-[var(--color-accent)]">
                Details
              </Link>
            }
          >
            This month
          </SectionTitle>

          <div className="flex items-baseline gap-3">
            <Money value={month.spend} size="xl" />
            {change !== null ? (
              <Badge tone={change > 0 ? 'bad' : 'good'}>
                {delta(change)} vs last month
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">
            {money(month.perDay)} a day over {month.elapsed}{' '}
            {month.elapsed === 1 ? 'day' : 'days'} · on track for {money(fc.projectedMonthTotal)}
          </p>

          <div className="mt-4 flex flex-col gap-2.5">
            {month.categories.slice(0, 5).map((c) => (
              <div key={c.key} className="flex items-center gap-3">
                <div className="w-24 shrink-0 truncate text-xs text-[var(--color-ink-2)]">{c.key}</div>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-raised)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-accent)]"
                    style={{ width: `${Math.max(2, c.share * 100)}%` }}
                  />
                </div>
                <div className="num w-20 shrink-0 text-right text-xs">{money(c.total)}</div>
              </div>
            ))}
            {month.categories.length === 0 ? (
              <Empty title="Nothing spent yet this month" />
            ) : null}
          </div>
        </Panel>

        <Panel>
          <SectionTitle
            action={
              <Link href="/spending/transactions" className="text-xs font-medium text-[var(--color-accent)]">
                All activity
              </Link>
            }
          >
            Recent
          </SectionTitle>

          {recent.length === 0 ? (
            <Empty title="No activity yet" />
          ) : (
            <ul className="flex flex-col">
              {recent.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 border-b border-[var(--color-line)] py-2.5 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{r.remarks || r.category}</div>
                    <div className="text-[11px] text-[var(--color-ink-3)]">
                      {formatDayShort(r.day)} · {r.method}
                      {r.kind === 'card_payment' ? ' · bill payment' : ''}
                      {r.kind === 'credit_given' ? ' · lent out' : ''}
                    </div>
                  </div>
                  <Money
                    value={r.amount}
                    size="md"
                    tone={r.kind === 'card_payment' ? 'credit' : 'neutral'}
                    className="shrink-0"
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <p className="mt-6 text-center text-[11px] text-[var(--color-ink-3)]">
        As of {formatDay(today)} · figures in INR
      </p>
    </Page>
  );
}
