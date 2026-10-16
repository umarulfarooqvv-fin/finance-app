import Link from 'next/link';
import { cardsView, currentSnapshot, forecastView } from '@/lib/views';
import { monthSummary, priorWindow, recentActivity } from '@/lib/analytics';
import type { StatementRow } from '@/lib/statement';
import { formatDay, formatDayShort, relativeDays } from '@/lib/time';
import { delta, money, moneyCompact } from '@/lib/format';
import { Page, PageHeader } from '@/components/layout/page-header';
import { photoNoticesForPage } from '@/lib/photo-check';
import { getSnapshot } from '@/lib/snapshot';
import { EditEntryButton } from '@/components/entry/entry-editor';
import { TagChips } from '@/components/entry/tag-input';
import { PhotoCorrections } from '@/components/photo-corrections';
import { Badge, Dot, Empty, Meter, Money, Panel, SectionTitle, cx } from '@/components/ui/primitives';
import { SpanSelect } from '@/components/today/span-select';
import { InfoTip } from '@/components/ui/info-tip';
import { spanFor, spanSummary } from '@/lib/day-spend';

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

/** How many of the span's entries Today lists before handing over to Entries. */
const SPAN_ROWS = 12;

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
  /* The notices and the snapshot load side by side. A correction made moments
     ago makes photoNoticesForPage drop the cached snapshot, and then
     currentSnapshot below loads again — so the balances still include it. In
     the usual case nothing was dropped and the warmed snapshot is reused. */
  const [{ corrections, questions }] = await Promise.all([photoNoticesForPage(), getSnapshot()]);
  const { snap, today } = await currentSnapshot();
  // Both go through the cached selectors: forecast() calls statementView()
  // internally, so without the dedupe the engine would run twice per render.
  const [view, fc] = await Promise.all([cardsView(), forecastView()]);
  const month = monthSummary(snap, today);
  const prior = priorWindow(snap, today);
  const recent = recentActivity(snap, today, 6);
  const recentDays: { day: string; rows: typeof recent }[] = [];
  for (const r of recent) {
    const last = recentDays.at(-1);
    if (last && last.day === r.day) last.rows.push(r);
    else recentDays.push({ day: r.day, rows: [r] });
  }

  // "What did I spend…" — today unless another span is chosen.
  const span = spanFor(one(sp.p), today, one(sp.d));
  const spent = spanSummary(snap, span);
  const spanChange = spent.prevSpent > 0 ? (spent.spent - spent.prevSpent) / spent.prevSpent : null;
  const spanDays: { day: string; rows: typeof spent.entries }[] = [];
  for (const r of spent.entries.slice(0, SPAN_ROWS)) {
    const last = spanDays.at(-1);
    if (last && last.day === r.day) last.rows.push(r);
    else spanDays.push({ day: r.day, rows: [r] });
  }
  const others = [
    ['Bills paid', spent.billsPaid],
    ['Lent', spent.lent],
    ['Saved', spent.saved],
    ['Received', spent.received],
  ].filter(([, v]) => (v as number) > 0) as [string, number][];

  const needsAction = view.rows.filter((r) => r.status === 'overdue' || r.status === 'due-soon');
  const change = prior.spend > 0 ? (month.spend - prior.spend) / prior.spend : null;
  const empty = snap.transactions.length === 0;

  return (
    <Page>
      <PageHeader
        title="Today"
        subtitle={`${formatDayShort(today)} · ${snap.transactions.length.toLocaleString('en-IN')} transactions tracked`}
      />

      {/* Here too: this is the page opened first, and a card balance just
          changed because of a photo. */}
      <PhotoCorrections corrections={corrections} questions={questions} />

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
      <Panel className="relative">
        {/* The glow is clipped on its own, so an info bubble can still
            overflow the panel instead of being cut off by it. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[var(--radius-card)]" aria-hidden="true">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[var(--color-accent-soft)] opacity-50 blur-2xl" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
            Recommended bank reserve
            <InfoTip label="What is the bank reserve?">
              Keep at least this much available to cover every card balance plus what you are on
              track to spend over the {fc.daysRemaining} {fc.daysRemaining === 1 ? 'day' : 'days'} left
              this month.
            </InfoTip>
          </div>
          <div className="mt-1.5">
            <Money value={fc.recommendedReserve} size="display" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
            <div className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2.5">
              <div className="flex items-center gap-1 text-[11px] text-[var(--color-ink-3)]">
                Card debt now
                <InfoTip label="What is card debt now?">
                  Owed on all cards today &mdash; billed and not yet billed.
                </InfoTip>
              </div>
              <Money value={fc.totalDebtLive} size="md" className="mt-0.5 block font-semibold" />
            </div>
            <div className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2.5">
              <div className="flex items-center gap-1 text-[11px] text-[var(--color-ink-3)]">
                Still to spend
                <InfoTip label="What is still to spend?">
                  Likely spending for the rest of the month, at your pace so far, plus anything
                  already logged for later this month.
                </InfoTip>
              </div>
              <Money value={fc.estimatedRemaining} size="md" className="mt-0.5 block font-semibold" />
            </div>
          </div>
        </div>
      </Panel>


      {/* ---- What was spent — today, or a span chosen from the dropdown ---- */}
      <Panel className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
            Spent{span.key === 'today' ? ' today' : ''}
          </h2>
          <SpanSelect value={span.key} day={span.key === 'day' ? span.from : undefined} today={today} />
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Money value={spent.spent} size="xl" />
          {spanChange !== null ? (
            <Badge tone={spanChange > 0 ? 'bad' : 'good'}>{delta(spanChange)} vs {span.prev.label}</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-[var(--color-ink-3)]">
          {span.from === span.to ? formatDay(span.from) : `${formatDay(span.from)} – ${formatDay(span.to)}`}
          {' · '}{spent.count} {spent.count === 1 ? 'spend' : 'spends'}
          {spent.days > 1 ? <> · <span className="sensitive">{money(spent.perDay)}</span> a day</> : null}
        </p>
        {others.length ? (
          <p className="mt-1 text-xs text-[var(--color-ink-3)]">
            {others.map(([k, v], i) => (
              <span key={k}>{i ? ' · ' : ''}{k} <span className="sensitive">{money(v)}</span></span>
            ))}
          </p>
        ) : null}

        {spent.categories.length > 1 ? (
          <div className="mt-3 flex flex-col gap-2">
            {spent.categories.slice(0, 4).map((c) => (
              <div key={c.key} className="flex items-center gap-3">
                <div className="w-24 shrink-0 truncate text-xs text-[var(--color-ink-2)]">{c.key}</div>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-raised)]">
                  <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.max(2, c.share * 100)}%` }} />
                </div>
                <div className="num sensitive w-20 shrink-0 text-right text-xs">{money(c.total)}</div>
              </div>
            ))}
          </div>
        ) : null}

        {spent.entries.length === 0 ? (
          <p className="mt-3 text-xs text-[var(--color-ink-3)]">Nothing recorded {span.key === 'today' ? 'yet today' : 'in this span'}.</p>
        ) : (
          <div className="mt-3 flex flex-col">
            {spanDays.map((d) => (
              <section key={d.day}>
                {span.from !== span.to ? (
                  <h3 className="border-b border-[var(--color-line)] pb-1 pt-2 text-[11px] font-medium text-[var(--color-ink-3)]">
                    {formatDayShort(d.day)}
                  </h3>
                ) : null}
                <ul>
                  {d.rows.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 border-b border-[var(--color-line)] py-2 last:border-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm">{r.remarks || r.category}</span>
                          <TagChips tags={r.tags} className="shrink-0" />
                        </div>
                        <div className="text-[11px] text-[var(--color-ink-3)]">
                          {r.ts.slice(11, 16)} · {r.category} · {r.method}
                          {r.kind === 'card_payment' ? ' · bill payment' : ''}
                          {r.kind === 'credit_given' ? ' · lent out' : ''}
                        </div>
                      </div>
                      <Money value={r.amount} size="sm" tone={r.kind === 'card_payment' ? 'credit' : 'neutral'} className="shrink-0" />
                      <EditEntryButton id={r.id} label={`Edit ${r.remarks || r.category}`} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs font-medium">
          {spent.entries.length ? (
            <Link href={`/transactions?from=${span.from}&to=${span.to}`} className="text-[var(--color-accent)]">
              {spent.entries.length > SPAN_ROWS ? `All ${spent.entries.length} entries` : 'Open in Entries'} &rarr;
            </Link>
          ) : <span />}
          {spent.days > 1 ? (
            <Link href={`/spending?p=range&from=${span.from}&to=${span.to}`} className="text-[var(--color-accent)]">
              Analyse &rarr;
            </Link>
          ) : null}
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
                    {row.remainingDueBill > 0 ? (
                      <>
                        <span className="sensitive">{money(row.remainingDueBill)}</span> on this bill
                      </>
                    ) : (
                      'Bill cleared'
                    )}
                    {row.unbilled > 0 ? (
                      <>
                        {' · '}
                        <span className="sensitive">{money(row.unbilled)}</span> unbilled
                      </>
                    ) : null}
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
            <span className="sensitive">{money(month.perDay)}</span> a day over {month.elapsed}{' '}
            {month.elapsed === 1 ? 'day' : 'days'} · on track for{' '}
            <span className="sensitive">{money(fc.projectedMonthTotal)}</span>
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
                <div className="num sensitive w-20 shrink-0 text-right text-xs">{money(c.total)}</div>
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
              <Link href="/transactions" className="text-xs font-medium text-[var(--color-accent)]">
                All activity
              </Link>
            }
          >
            Recent
          </SectionTitle>

          {recent.length === 0 ? (
            <Empty title="No activity yet" />
          ) : (
            /* By day, like every list of entries in the app. */
            <div className="flex flex-col">
              {recentDays.map((d) => (
                <section key={d.day}>
                  <h3 className="border-b border-[var(--color-line)] pb-1 pt-2.5 text-[11px] font-medium text-[var(--color-ink-3)] first:pt-0">
                    {formatDayShort(d.day)}
                  </h3>
                  <ul className="flex flex-col">
                    {d.rows.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center gap-2 border-b border-[var(--color-line)] py-2.5 last:border-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-sm">{r.remarks || r.category}</span>
                            <TagChips tags={r.tags} className="shrink-0" />
                          </div>
                          <div className="text-[11px] text-[var(--color-ink-3)]">
                            {r.method}
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
                        <EditEntryButton id={r.id} label={`Edit ${r.remarks || r.category}`} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <p className="mt-6 text-center text-[11px] text-[var(--color-ink-3)]">
        As of {formatDay(today)} · figures in INR
      </p>
    </Page>
  );
}
