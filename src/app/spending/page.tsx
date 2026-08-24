import Link from 'next/link';
import { getSnapshot } from '@/lib/snapshot';
import {
  byMethod, byTrip, dailySeries, lastCompleteMonth, monthSummary,
  monthlySeries, priorWindow, spendBetween,
} from '@/lib/analytics';
import { forecast } from '@/lib/forecast';
import { dayOf, formatDay, monthKey, monthStart } from '@/lib/time';
import { DailyColumns, RankedBars, TrendLine } from '@/components/charts/charts';
import { delta, money } from '@/lib/format';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Badge, Empty, Panel, SectionTitle, Stat, StatGrid } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Spending — where the money goes.

   Absorbs v2's /detailed, /charts and /insights. One page, because they were
   three views of the same question and splitting them meant checking three
   places to answer it.
   =========================================================================== */

export default async function SpendingPage() {
  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);

  const month = monthSummary(snap, today);
  const prior = priorWindow(snap, today);
  const fc = forecast(snap, today);
  // Completed months only — see monthlySeries for why the bound matters.
  const monthly = monthlySeries(snap, { until: lastCompleteMonth(today) });
  const daily = dailySeries(snap, monthStart(monthKey(today)), today);
  const rows = spendBetween(snap, monthStart(monthKey(today)), today);
  const trips = byTrip(spendBetween(snap, '2020-01-01', today));

  const change = prior.spend > 0 ? (month.spend - prior.spend) / prior.spend : null;
  // A long history makes the early years unreadable; two years is the useful window.
  const trend = monthly.slice(-24);

  return (
    <Page>
      <PageHeader
        title="Spending"
        subtitle={`${formatDay(month.from)} to ${formatDay(today)}`}
        action={
          <Link
            href="/spending/transactions"
            className="rounded-[var(--radius-field)] border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-line-strong)]"
          >
            All transactions
          </Link>
        }
      />

      <Panel>
        <StatGrid cols={4}>
          <Stat label="Spent this month" value={month.spend} />
          <Stat label="Per day" value={month.perDay} hint={`over ${month.elapsed} days`} />
          <Stat
            label="On track for"
            value={fc.projectedMonthTotal}
            hint={`${fc.daysRemaining} days left`}
          />
          <Stat label="Income this month" value={month.income} tone="credit" />
        </StatGrid>

        {change !== null ? (
          <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-4 text-xs text-[var(--color-ink-2)]">
            <Badge tone={change > 0 ? 'bad' : 'good'}>{delta(change)}</Badge>
            versus <span className="sensitive">{money(prior.spend)}</span> over the same {month.elapsed}{' '}
            {month.elapsed === 1 ? 'day' : 'days'} of last month
          </p>
        ) : null}
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionTitle>By category</SectionTitle>
          <RankedBars data={month.categories} onEmpty="Nothing spent yet this month" />
        </Panel>

        <Panel>
          <SectionTitle>By payment method</SectionTitle>
          <RankedBars data={byMethod(rows)} hue="var(--card-1)" onEmpty="Nothing spent yet this month" />
        </Panel>
      </div>

      <Panel className="mt-4">
        <SectionTitle>Every day this month</SectionTitle>
        <DailyColumns data={daily} />
      </Panel>

      <Panel className="mt-4">
        <SectionTitle>Monthly trend · last {trend.length} complete months</SectionTitle>
        <TrendLine data={trend} />
        <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
          Completed months only, so the part-finished current month does not read as a collapse.
          Consumption only — card bill payments, money lent out and transfers into savings are
          excluded, so paying three bills in one month is not a spending spike.
        </p>
      </Panel>

      {trips.length > 0 ? (
        <Panel className="mt-4">
          <SectionTitle>Trips</SectionTitle>
          <RankedBars data={trips} hue="var(--card-3)" limit={6} />
        </Panel>
      ) : null}

      {month.categories.length === 0 && monthly.length === 0 ? (
        <Panel className="mt-4">
          <Empty title="No spending recorded" hint="Entries posted from the Shortcut appear here." />
        </Panel>
      ) : null}
    </Page>
  );
}
