import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getSnapshot } from '@/lib/snapshot';
import { statementReport } from '@/lib/statement-report';
import { delta, money } from '@/lib/format';
import { formatDay, formatDayShort, nowIST } from '@/lib/time';
import { Page, PageHeader } from '@/components/layout/page-header';
import {
  Badge, Empty, Money, Panel, SectionTitle, Stat, StatGrid, TableWrap, Td, Th, cx,
} from '@/components/ui/primitives';
import { DailyColumns, RankedBars, TrendLine } from '@/components/charts/charts';
import { InfoTip } from '@/components/ui/info-tip';
import { Private } from '@/contexts/privacy-context';
import { LentSection, PrintButton, StatementPicker } from './report-client';
import { SplitBar } from './split-bar';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   A card statement, explained.

   Read top to bottom it answers, in order: how big is the bill, how much of it
   was mine, did the lent part come back, where did my spending go, when, and
   how does this bill compare with the last. Every figure comes from the same
   engine as the rest of the app (lib/statement-report), so it cannot disagree
   with the card page — and every lent amount can be marked as paid back from
   here, because the usual reason it looks unpaid is that nobody wrote it down.
   =========================================================================== */

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default async function StatementReportPage({
  params, searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ cycle?: string }>;
}) {
  const { name } = await params;
  const { cycle } = await searchParams;
  const snap = await getSnapshot();
  const r = statementReport(snap, decodeURIComponent(name), cycle);
  if (!r) notFound();

  const cardHref = `/cards/${encodeURIComponent(r.card)}`;
  const { bill, parts } = r;
  const ownShare = bill.charges > 0 ? parts.own / bill.charges : 0;
  const lentShare = bill.charges > 0 ? parts.lent / bill.charges : 0;
  const prev = r.versus;
  const ownChange = prev && prev.own > 0 ? (parts.own - prev.own) / prev.own : null;
  const lentPeople = r.people.length;
  const unlinkedHere = r.unlinked;

  return (
    <Page>
      <PageHeader
        title={`${r.card} · statement report`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={cardHref} className="inline-flex items-center gap-1 text-[var(--color-accent)]">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {r.card}
            </Link>
            <span>
              Bill of {formatDay(r.cycle.statementEnd)} · spending from {formatDay(r.cycle.cycleStart)} to {formatDay(r.cycle.periodEnd)}
            </span>
          </span>
        }
      />

      {/* Not in the header: that row is frozen to the top of every page and a
          phone has room for the title and its four icons, not a picker too. */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <StatementPicker card={r.card} value={r.cycle.statementEnd} options={r.statements} />
        <PrintButton />
      </div>

      {/* ---- 1. The bill, in plain words --------------------------------- */}
      <Panel>
        <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">
          This bill is <Money value={bill.closing} size="md" className="font-semibold text-[var(--color-ink)]" />.
          Of the <Money value={bill.charges} size="md" /> charged to the card,{' '}
          <Money value={parts.own} size="md" className="font-semibold text-[var(--color-ink)]" /> ({pct(ownShare)}) was your own spending
          {parts.lent > 0 ? (
            <>
              {' '}and <Money value={parts.lent} size="md" className="font-semibold text-[var(--color-ink)]" /> ({pct(lentShare)}) was lent to others
              {r.lentSplit.waiting > 0.005 ? (
                <>
                  {' '}— <Money value={r.lentSplit.returned} size="md" tone="credit" /> has come back and{' '}
                  <Money value={r.lentSplit.waiting} size="md" tone="debt" className="font-semibold" /> is still to come
                </>
              ) : <> — all of it has come back</>}
            </>
          ) : null}
          .
        </p>

        <div className="mt-4">
          <StatGrid cols={4}>
            <Stat
              label="Bill amount"
              value={bill.closing}
              hint={
                <>
                  Due {formatDay(r.cycle.dueDate)} ·{' '}
                  {bill.paidInFull
                    ? <span className="text-[var(--color-pos)]">paid in full</span>
                    : <><Money value={bill.unpaid} size="sm" tone="debt" /> unpaid</>}
                </>
              }
            />
            <Stat label="Charged this cycle" value={bill.charges} hint="everything put on the card" />
            <Stat
              label={<span className="inline-flex items-center gap-1">Your own spending
                <InfoTip label="What counts as spending?">
                  Money you consumed. Left out: lending to others, card bill payments and transfers
                  into savings — they are not spending, and counting them makes a bill look worse than it was.
                </InfoTip></span>}
              value={parts.own}
              hint={ownChange !== null
                ? <>{delta(ownChange)} vs the bill before</>
                : `${pct(ownShare)} of what was charged`}
            />
            <Stat
              label="Lent to others"
              value={parts.lent}
              tone={r.lentSplit.waiting > 0.005 ? 'debt' : 'neutral'}
              hint={parts.lent > 0
                ? <><Money value={r.lentSplit.waiting} size="sm" /> still to come</>
                : 'nothing lent'}
            />
          </StatGrid>
        </div>

        <div className="mt-5 border-t border-[var(--color-line)] pt-4">
          <SplitBar
            label="How the charges on this bill divide"
            parts={[
              { label: 'Your own spending', value: parts.own, color: 'var(--color-accent)' },
              { label: 'Lent — already back', value: r.lentSplit.returned, color: 'var(--color-pos)' },
              { label: 'Lent — still to come', value: r.lentSplit.waiting, color: 'var(--color-warn)', note: lentPeople ? `${lentPeople} ${lentPeople === 1 ? 'person' : 'people'}` : undefined },
              { label: 'Other & uncategorised', value: parts.other, color: 'var(--color-ink-3)' },
            ]}
          />
        </div>
      </Panel>

      {/* ---- 2. Lent money — has it come back? --------------------------- */}
      <Panel className="mt-4">
        <SectionTitle>Money lent from this bill{r.people.length ? ` · ${r.people.length}` : ''}</SectionTitle>
        {r.people.length === 0 ? (
          <Empty title="Nothing was lent on this bill" hint="Charges with the Credit Given category appear here, with whether each has been paid back." />
        ) : (
          <>
            <p className="mb-3 text-xs text-[var(--color-ink-3)]">
              Forgot to write down that somebody paid you back? Press <em>Mark as paid</em>, say when and into which
              account, and it is counted against what they owe. A return always settles the oldest lending first.
            </p>
            <LentSection people={r.people} unlinked={unlinkedHere} defaultTs={nowIST()} />
          </>
        )}
      </Panel>

      {/* ---- 3. Where own spending went ---------------------------------- */}
      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionTitle>Your spending by category</SectionTitle>
          <RankedBars data={r.categories} limit={8} onEmpty="No spending of your own on this bill" />
          <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
            <Link href={`${cardHref}/analysis?window=statement`} className="text-[var(--color-accent)]">
              Open every entry by category →
            </Link>
          </p>
        </Panel>

        <Panel>
          <SectionTitle>Occasions &amp; tags</SectionTitle>
          {r.tags.length === 0 ? (
            <Empty title="No tags on this bill" hint="Tag a trip or an occasion on an entry and its total shows here." />
          ) : (
            <TableWrap minWidth={0}>
              <thead>
                <tr><Th>Tag</Th><Th align="right">Entries</Th><Th align="right">Spent</Th></tr>
              </thead>
              <tbody>
                {r.tags.slice(0, 8).map((t) => (
                  <tr key={t.key}>
                    <Td className="font-medium"><Private>{t.key}</Private></Td>
                    <Td align="right" className="num text-[var(--color-ink-3)]">{t.count}</Td>
                    <Td align="right"><Money value={t.total} size="sm" /></Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </section>

      {/* ---- 4. When ------------------------------------------------------ */}
      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionTitle>Day by day</SectionTitle>
          <DailyColumns data={r.days.series} height={110} />
          <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
            <div>
              <dt className="text-[var(--color-ink-3)]">Busiest day</dt>
              <dd className="mt-0.5 font-medium">
                {r.days.busiest ? <>{formatDayShort(r.days.busiest.day)} · <Money value={r.days.busiest.total} size="sm" /></> : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-ink-3)]">A typical day</dt>
              <dd className="mt-0.5 font-medium"><Money value={r.days.perDay} size="sm" /></dd>
            </div>
            <div>
              <dt className="text-[var(--color-ink-3)]">Days with spending</dt>
              <dd className="num mt-0.5 font-medium">{r.days.spendingDays} of {r.days.count}</dd>
            </div>
          </dl>
        </Panel>

        <Panel>
          <SectionTitle>Which days of the week</SectionTitle>
          <RankedBars data={r.weekdays} limit={7} onEmpty="No spending to show" />
        </Panel>
      </section>

      {/* ---- 5. The biggest charges -------------------------------------- */}
      <Panel className="mt-4">
        <SectionTitle>Biggest charges</SectionTitle>
        <TableWrap minWidth={0}>
          <thead>
            <tr><Th>Date</Th><Th>What</Th><Th>Kind</Th><Th align="right">Amount</Th></tr>
          </thead>
          <tbody>
            {r.largest.map((t) => (
              <tr key={t.id}>
                <Td className="whitespace-nowrap text-xs text-[var(--color-ink-3)]">{formatDayShort(t.ts.slice(0, 10)).split(',')[0]}</Td>
                <Td className="max-w-[16rem] truncate"><Private>{t.remarks || t.category}</Private></Td>
                <Td>{t.lent ? <Badge tone="warn">Lent</Badge> : <span className="text-xs text-[var(--color-ink-3)]">{t.category}</span>}</Td>
                <Td align="right"><Money value={t.amount} size="sm" className="font-semibold" /></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Panel>

      {/* ---- 6. Against the other bills ---------------------------------- */}
      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionTitle>The last {r.recent.length} bills</SectionTitle>
          <TableWrap minWidth={0}>
            <thead>
              <tr><Th>Bill of</Th><Th align="right">Yours</Th><Th align="right">Lent</Th><Th align="right">Bill</Th></tr>
            </thead>
            <tbody>
              {r.recent.map((x) => (
                <tr key={x.statementEnd} className={cx(x.statementEnd === r.cycle.statementEnd && 'bg-[var(--color-accent-soft)]')}>
                  <Td className="whitespace-nowrap text-xs">{formatDay(x.statementEnd)}</Td>
                  <Td align="right"><Money value={x.own} size="sm" /></Td>
                  <Td align="right"><Money value={x.lent} size="sm" tone="muted" /></Td>
                  <Td align="right"><Money value={x.closing} size="sm" className="font-semibold" /></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {r.recent.length >= 2 ? (
            <div className="mt-4">
              <TrendLine data={r.recent.map((x) => ({ month: x.statementEnd.slice(0, 7), total: x.closing }))} height={130} />
            </div>
          ) : null}
        </Panel>

        <Panel>
          <SectionTitle>Compared with the bill before</SectionTitle>
          {!prev ? (
            <Empty title="No earlier bill to compare" hint="This is the first statement on record for the card." />
          ) : (
            <>
              <p className="mb-3 text-xs text-[var(--color-ink-3)]">Against the bill of {formatDay(prev.previous)}.</p>
              <TableWrap minWidth={0}>
                <thead>
                  <tr><Th>Category</Th><Th align="right">Before</Th><Th align="right">Now</Th><Th align="right">Change</Th></tr>
                </thead>
                <tbody>
                  {prev.categories.map((c) => {
                    const diff = Math.round((c.now - c.before) * 100) / 100;
                    return (
                      <tr key={c.key}>
                        <Td className="font-medium">{c.key}</Td>
                        <Td align="right"><Money value={c.before} size="sm" tone="muted" /></Td>
                        <Td align="right"><Money value={c.now} size="sm" /></Td>
                        <Td align="right">
                          <span className={cx('num sensitive text-xs font-medium', diff > 0.005 ? 'text-[var(--color-neg)]' : diff < -0.005 ? 'text-[var(--color-pos)]' : 'text-[var(--color-ink-3)]')}>
                            {diff > 0.005 ? '+' : diff < -0.005 ? '−' : ''}{money(Math.abs(diff))}
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            </>
          )}
        </Panel>
      </section>

      {/* ---- 7. The arithmetic ------------------------------------------- */}
      <Panel className="mt-4">
        <SectionTitle>How the bill adds up</SectionTitle>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span>Brought forward <Money value={bill.opening} size="sm" className="font-semibold" /></span>
          <span className="text-[var(--color-ink-3)]">+</span>
          <span>Charged <Money value={bill.charges} size="sm" className="font-semibold" /></span>
          <span className="text-[var(--color-ink-3)]">−</span>
          <span>Paid in the cycle <Money value={bill.payments} size="sm" tone="credit" className="font-semibold" /></span>
          <span className="text-[var(--color-ink-3)]">=</span>
          <span>Bill <Money value={bill.closing} size="md" className="font-semibold" /></span>
        </div>
        <p className="mt-3 text-xs text-[var(--color-ink-3)]">
          {bill.bank
            ? Math.abs(bill.bank.diff) < 0.005
              ? 'The bank’s own figure for this statement matches exactly.'
              : <>The bank says <Money value={bill.bank.due} size="sm" /> — the app differs by <Money value={Math.abs(bill.bank.diff)} size="sm" />.</>
            : <>Not yet checked against the bank. <Link className="text-[var(--color-accent)]" href={`/reconcile?card=${encodeURIComponent(r.card)}&cycle=${r.cycle.statementEnd}`}>Check this statement</Link> to compare it line by line.</>}
        </p>
      </Panel>
    </Page>
  );
}
