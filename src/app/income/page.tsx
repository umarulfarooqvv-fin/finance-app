import { headers } from 'next/headers';
import { getSnapshot } from '@/lib/snapshot';
import { incomeBetween } from '@/lib/analytics';
import { round2 } from '@/lib/money';
import { dayOf, formatMonth, monthKey, monthStart, nowIST } from '@/lib/time';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Panel, SectionTitle, Stat, StatGrid } from '@/components/ui/primitives';
import { IncomeClient, type MonthGroup, type Row } from './income-client';
import { ShortcutSetup } from './shortcut-setup';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Income — money coming in.

   It had no page. Income could arrive from the Shortcut and from the sheet
   import, and it was visible as a list on /money, but nothing could add,
   correct or remove one: a mistyped salary could only be fixed in the
   database.

   Spending lives under Entries; this is deliberately separate rather than a
   filter on that list, because the two answer different questions and mixing
   them into one ledger is what makes a month of bill payments look like a
   spending disaster.
   =========================================================================== */

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const sp = await searchParams;
  const showDeleted = sp.deleted === '1';

  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);

  /* The Shortcut needs a URL it can paste. Taken from the request rather than
     an env var so it is correct wherever this happens to be served from. */
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = host ? `${proto}://${host}` : '';
  const thisMonth = monthKey(today);
  const yearStart = `${today.slice(0, 4)}-01-01`;

  const rows = snap.income
    .filter((i) => i.ts && i.amount != null && i.deleted === showDeleted)
    .sort((a, b) => (a.ts! < b.ts! ? 1 : -1));

  const groups: MonthGroup[] = [];
  for (const i of rows) {
    const key = monthKey(i.ts!);
    let g = groups.at(-1);
    if (!g || g.month !== key) {
      g = { month: key, label: formatMonth(key), total: 0, rows: [] };
      groups.push(g);
    }
    g.total = round2(g.total + (i.amount ?? 0));
    g.rows.push({
      id: i.id,
      ts: i.ts!,
      amount: i.amount ?? 0,
      source: i.source,
      account: i.account,
      remarks: i.remarks,
      needsReview: i.needsReview,
      deleted: i.deleted,
    } satisfies Row);
  }

  const monthTotal = incomeBetween(snap, monthStart(thisMonth), today);
  const yearTotal = incomeBetween(snap, yearStart, today);
  const allTime = round2(
    snap.income.filter((i) => !i.deleted).reduce((a, i) => a + (i.amount ?? 0), 0),
  );

  return (
    <Page>
      <PageHeader
        title="Income"
        subtitle={showDeleted ? 'Deleted entries' : 'Money coming in'}
      />

      <Panel className="mb-4">
        <StatGrid cols={4}>
          <Stat label="This month" value={monthTotal} tone="credit" />
          <Stat label={`${today.slice(0, 4)} so far`} value={yearTotal} tone="credit" />
          <Stat label="Recorded in total" value={allTime} tone="credit" />
          <Stat
            label="Entries"
            value={snap.income.filter((i) => !i.deleted).length.toLocaleString('en-IN')}
          />
        </StatGrid>
      </Panel>

      <Panel padded={false}>
        <div className="p-4 sm:p-5">
          <IncomeClient groups={groups} defaultTs={nowIST()} />
        </div>
      </Panel>

      <Panel className="mt-4">
        <SectionTitle>Post income from your iPhone</SectionTitle>
        <ShortcutSetup origin={origin} />
      </Panel>
    </Page>
  );
}
