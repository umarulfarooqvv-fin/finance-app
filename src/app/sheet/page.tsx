import { currentSnapshot } from '@/lib/views';
import { sheetRows } from '@/lib/sheet';
import { Page, PageHeader } from '@/components/layout/page-header';
import { SheetClient } from './sheet-client';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Every entry as a spreadsheet — filter any column, sort on several, group
   with subtotals, total what is ticked, pivot, export. All of it runs in the
   browser over the rows sent once, so nothing waits on the server while you
   slice. Spends and money received are one sheet, told apart by Type.
   =========================================================================== */

export default async function SheetPage() {
  const { snap, today } = await currentSnapshot();
  const rows = sheetRows(snap.transactions, snap.income);
  return (
    <Page>
      <PageHeader title="Sheet" subtitle="Filter, sort, group, total and pivot every entry" />
      <SheetClient rows={rows} today={today} />
    </Page>
  );
}
