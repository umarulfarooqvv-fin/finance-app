import Link from 'next/link';
import { getSnapshot } from '@/lib/snapshot';
import {
  byCategory, byMethod, byTrip, dailySeries, incomeBetween, lastCompleteMonth,
  monthlySeries, round2, spendBetween, total,
} from '@/lib/analytics';
import { forecast } from '@/lib/forecast';
import { dayOf, formatDay, monthKey } from '@/lib/time';
import { DailyColumns, RankedBars, TrendLine } from '@/components/charts/charts';
import { delta, money } from '@/lib/format';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Badge, Empty, Panel, SectionTitle, Stat, StatGrid } from '@/components/ui/primitives';
import { comparisonFor, granularity, readPeriod, type RawParams } from '@/lib/period';
import { cardCost } from '@/lib/card-cost';
import { PeriodPicker } from './period-picker';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Spending — where the money goes, over whatever stretch of time you pick.

   Absorbs v2's /detailed, /charts and /insights. One page, because they were
   three views of the same question and splitting them meant checking three
   places to answer it.

   Every figure below is derived from one [from, to] resolved in period.ts.
   Nothing here redefines what spending is: `isSpend` still excludes card bill
   payments, money lent and transfers, so a month with three bills paid is not
   a spending spike no matter which period is selected.
   =========================================================================== */

export default async function SpendingPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const sp = await searchParams;
  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);

  const dated = snap.transactions.filter((t) => t.ts);
  const earliest = dated.reduce<string>((a, t) => (a === '' || t.ts! < a ? t.ts! : a), '').slice(0, 10);
  const period = readPeriod(sp, today, earliest || today);

  const rows = spendBetween(snap, period.from, period.to);
  const spend = total(rows);
  const income = incomeBetween(snap, period.from, period.to);
  const perDay = round2(spend / period.days);

  const comparison = comparisonFor(period);
  const priorSpend = comparison ? total(spendBetween(snap, comparison.from, comparison.to)) : 0;
  const change = comparison && priorSpend > 0 ? (spend - priorSpend) / priorSpend : null;

  /* The forecast projects the CURRENT month to its end. It is meaningless for
     a period that has already closed, and showing it against a historical
     range would put a projection where a fact belongs. */
  const fc = period.kind === 'mtd' ? forecast(snap, today) : null;

  const cost = cardCost(snap, period.from, period.to);
  const daily = dailySeries(snap, period.from, period.to);
  const byMonth = monthsWithin(rows, period.from, period.to);
  const trips = byTrip(rows);

  // Offered periods come from the data, so an empty month is never a choice.
  const months = [...new Set(dated.map((t) => monthKey(t.ts!)))].sort().reverse();
  const years = [...new Set(months.map((m) => m.slice(0, 4)))].sort().reverse();

  // Context, independent of the selection: the long shape of the last 2 years.
  const trend = monthlySeries(snap, { until: lastCompleteMonth(today) }).slice(-24);

  return (
    <Page>
      <PageHeader
        title="Spending"
        subtitle={`${period.label} · ${formatDay(period.from)} to ${formatDay(period.to)}`}
        action={
          <Link
            href="/transactions"
            className="rounded-[var(--radius-field)] border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-line-strong)]"
          >
            All transactions
          </Link>
        }
      />

      <Panel className="mb-4">
        <PeriodPicker period={period} months={months} years={years} />
      </Panel>

      <Panel>
        <StatGrid cols={4}>
          <Stat label={period.running ? `Spent ${lower(period.label)}` : 'Spent'} value={spend} />
          <Stat
            label="Per day"
            value={perDay}
            hint={`over ${period.days} ${period.days === 1 ? 'day' : 'days'}`}
          />
          {fc ? (
            <Stat label="On track for" value={fc.projectedMonthTotal} hint={`${fc.daysRemaining} days left`} />
          ) : (
            <Stat label="Entries" value={rows.length.toLocaleString('en-IN')} hint="that count as spending" />
          )}
          <Stat label="Income" value={income} tone="credit" />
        </StatGrid>

        {change !== null && comparison ? (
          <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-4 text-xs text-[var(--color-ink-2)]">
            <Badge tone={change > 0 ? 'bad' : 'good'}>{delta(change)}</Badge>
            versus <span className="sensitive">{money(priorSpend)}</span> over {comparison.label}
          </p>
        ) : comparison ? (
          <p className="mt-4 border-t border-[var(--color-line)] pt-4 text-xs text-[var(--color-ink-3)]">
            Nothing recorded over {comparison.label}, so there is no change to report.
          </p>
        ) : null}
      </Panel>

      {/* ---- What the cards charged for being used ---------------------
           Surcharges and their tax are ordinary spend rows, so they are
           already inside every total above — which is exactly why they are
           invisible. One number is the only form in which anyone decides to
           do something about them. */}
      {cost.total > 0.005 ? (
        <Panel className="mt-4">
          <SectionTitle>What the cards cost &middot; {cost.count}</SectionTitle>
          <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Fees and tax" value={cost.total} tone="debt" />
            <Stat
              label="Of your spending"
              value={`${(cost.shareOfSpend * 100).toFixed(1)}%`}
              hint={`${period.label.toLowerCase()}`}
            />
            <Stat
              label="Could change"
              value={cost.avoidable}
              tone={cost.avoidable > 0.005 ? 'debt' : 'neutral'}
              hint="not tied to an instalment"
            />
            <Stat
              label="Already committed"
              value={cost.committed}
              tone="muted"
              hint="instalment charges"
            />
          </div>
          <RankedBars data={cost.byCard} limit={6} hue="var(--color-warn)" onEmpty="No fees in this period" />
          <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
            Split because the two answer different questions: an instalment&rsquo;s charges were
            agreed when the plan started and run to its end, while a fuel surcharge is a choice
            about which card goes into which pump and can stop this week.
          </p>
        </Panel>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionTitle>By category</SectionTitle>
          <RankedBars data={byCategory(rows)} onEmpty="Nothing spent in this period" />
        </Panel>

        <Panel>
          <SectionTitle>By payment method</SectionTitle>
          <RankedBars data={byMethod(rows)} hue="var(--card-1)" onEmpty="Nothing spent in this period" />
        </Panel>
      </div>

      <Panel className="mt-4">
        {granularity(period) === 'day' ? (
          <>
            <SectionTitle>Every day</SectionTitle>
            <DailyColumns data={daily} />
          </>
        ) : (
          <>
            <SectionTitle>Month by month</SectionTitle>
            {/* Past a quarter, a column per day is a picket fence. */}
            <TrendLine data={byMonth} />
          </>
        )}
      </Panel>

      {trips.length > 0 ? (
        <Panel className="mt-4">
          <SectionTitle>Trips in this period</SectionTitle>
          <RankedBars data={trips} hue="var(--card-3)" limit={6} />
        </Panel>
      ) : null}

      <Panel className="mt-4">
        <SectionTitle>Monthly trend · last {trend.length} complete months</SectionTitle>
        <TrendLine data={trend} />
        <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
          The long shape, regardless of the period selected above. Completed months only, so the
          part-finished current month does not read as a collapse. Consumption only — card bill
          payments, money lent out and transfers into savings are excluded, so paying three bills in
          one month is not a spending spike.
        </p>
      </Panel>

      {rows.length === 0 ? (
        <Panel className="mt-4">
          <Empty
            title="Nothing spent in this period"
            hint="Pick a wider stretch of time, or add an entry."
          />
        </Panel>
      ) : null}
    </Page>
  );
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Monthly totals inside the selected range, zero-filled so gaps stay visible. */
function monthsWithin(
  rows: { ts: string | null; amount: number | null }[],
  from: string,
  to: string,
): { month: string; total: number }[] {
  const sums = new Map<string, number>();
  for (const t of rows) {
    if (!t.ts) continue;
    const k = t.ts.slice(0, 7);
    sums.set(k, (sums.get(k) ?? 0) + (t.amount ?? 0));
  }
  const out: { month: string; total: number }[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let guard = 0; guard < 1200; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ month: key, total: round2(sums.get(key) ?? 0) });
    if (key >= end) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
