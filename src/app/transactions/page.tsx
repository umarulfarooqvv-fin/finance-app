import Link from 'next/link';
import { currentSnapshot } from '@/lib/views';
import { isSpend, upcomingRows } from '@/lib/analytics';
import { endOfDay, formatDay, monthKey, nowIST } from '@/lib/time';
import { round2 } from '@/lib/money';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Panel } from '@/components/ui/primitives';
import { applyFilters, isNarrowed, queryString, readFilters, type RawParams } from './filters';
import { FilterBar } from './filter-bar';
import { TransactionsClient, type DayGroup, type Row } from './transactions-client';

export const dynamic = 'force-dynamic';

/* Whole days per page, never a split one. A day header states that day's
   total, and a total computed from half a day is simply a wrong number on
   screen — so the page boundary moves to the day boundary instead. */
const TARGET_ROWS = 100;

/* ===========================================================================
   Guard, fetch, filter, group, strip, render.

   "Strip" matters even in a single-user app: whatever this passes down ships
   in the RSC payload and is readable in the browser. So the client gets the
   fields the table needs and nothing else - no internal ids beyond the row
   key, no source, no tag blobs.
   =========================================================================== */

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const sp = await searchParams;
  const { snap, today } = await currentSnapshot();
  const now = endOfDay(today);

  const f = readFilters(sp);
  const matched = applyFilters(snap.transactions, f, now).sort((a, b) => (a.ts! < b.ts! ? 1 : -1));

  // Group first, then page over whole days.
  const groups: { day: string; rows: typeof matched }[] = [];
  for (const t of matched) {
    const d = t.ts!.slice(0, 10);
    const last = groups.at(-1);
    if (last && last.day === d) last.rows.push(t);
    else groups.push({ day: d, rows: [t] });
  }

  const pageBuckets: (typeof groups)[] = [];
  let bucket: typeof groups = [];
  let count = 0;
  for (const g of groups) {
    bucket.push(g);
    count += g.rows.length;
    if (count >= TARGET_ROWS) { pageBuckets.push(bucket); bucket = []; count = 0; }
  }
  if (bucket.length) pageBuckets.push(bucket);

  const pages = Math.max(1, pageBuckets.length);
  const page = Math.min(f.page, pages);
  const visible = pageBuckets[page - 1] ?? [];

  const dayGroups: DayGroup[] = visible.map((g) => ({
    day: g.day,
    /* The day's SPEND, by the same definition the rest of the app uses: bill
       payments, money lent and transfers are excluded. A day whose only row is
       a bill payment therefore reads 0 spent, which is the honest answer - the
       charge was counted when it was made. */
    spent: round2(g.rows.filter(isSpend).reduce((a, t) => a + (t.amount ?? 0), 0)),
    rows: g.rows.map(
      (t): Row => ({
        id: t.id,
        ts: t.ts!,
        amount: t.amount ?? 0,
        method: t.method,
        category: t.category,
        remarks: t.remarks,
        kind: t.kind,
        verified: t.verified,
        deleted: t.deleted,
        isFuture: t.ts! > now,
      }),
    ),
  }));

  const hiddenUpcoming = f.upcoming ? 0 : upcomingRows(snap, today).length;
  const qs = (over: Record<string, string | undefined>) => queryString(sp, over);

  // Offered months come from the data, so a month that holds nothing is never
  // offered as a choice.
  const months = [...new Set(snap.transactions.filter((t) => t.ts).map((t) => monthKey(t.ts!)))]
    .sort()
    .reverse();

  const totalShown = round2(matched.reduce((a, t) => a + (t.amount ?? 0), 0));
  const spendShown = round2(matched.filter(isSpend).reduce((a, t) => a + (t.amount ?? 0), 0));

  return (
    <Page>
      <PageHeader
        title="Transactions"
        subtitle={`${matched.length.toLocaleString('en-IN')} ${matched.length === 1 ? 'entry' : 'entries'}${f.deleted ? ' · deleted' : ''}`}
      />

      {/* Search, filters and New entry live INSIDE this panel now, in a bar
          frozen to the top of it — they were a separate panel above, which
          scrolled away on a list thousands of rows long. */}
      <Panel padded={false}>
        <div className="p-4 sm:p-5">
          <TransactionsClient
            groups={dayGroups}
            defaultTs={nowIST()}
            nowIso={now}
            toolbar={
              <>
                <FilterBar
                  months={months}
                  initial={{
                    q: sp['q'] as string | undefined,
                    month: f.month,
                    day: f.day,
                    category: f.category,
                    method: f.method,
                    min: sp['min'] as string | undefined,
                    max: sp['max'] as string | undefined,
                    upcoming: f.upcoming,
                    deleted: f.deleted,
                  }}
                  narrowed={isNarrowed(f)}
                  matched={matched.length}
                  total={totalShown}
                  spend={spendShown}
                />

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-ink-3)]">
                  {hiddenUpcoming > 0 || f.upcoming ? (
                    <span className="flex items-center gap-2">
                      {f.upcoming
                        ? 'Including rows dated in the future.'
                        : `${hiddenUpcoming} pre-logged future ${hiddenUpcoming === 1 ? 'row is' : 'rows are'} hidden.`}
                      <Link
                        href={qs({ upcoming: f.upcoming ? undefined : '1', page: undefined })}
                        className="font-medium text-[var(--color-accent)]"
                      >
                        {f.upcoming ? 'Hide' : 'Show'}
                      </Link>
                    </span>
                  ) : null}
                  <Link
                    href={qs({ deleted: f.deleted ? undefined : '1', page: undefined })}
                    className="font-medium text-[var(--color-accent)]"
                  >
                    {f.deleted ? 'Back to active entries' : 'View deleted'}
                  </Link>
                </div>
              </>
            }
          />
        </div>
      </Panel>

      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-xs">
          {page > 1 ? (
            <Link href={qs({ page: String(page - 1) })} className="font-medium text-[var(--color-accent)]">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[var(--color-ink-3)]">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={qs({ page: String(page + 1) })} className="font-medium text-[var(--color-accent)]">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}

      <p className="mt-4 text-center text-[11px] text-[var(--color-ink-3)]">As of {formatDay(today)}</p>
    </Page>
  );
}
