import { getSnapshot } from '@/lib/snapshot';
import { nowIST } from '@/lib/time';
import { ALL_CATEGORIES, ALL_METHODS } from '@/lib/types';
import { Page, PageHeader } from '@/components/layout/page-header';
import { ImportClient } from './import-client';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Importing a backlog.

   Entries get missed in the weeks there is no time to log them, and what
   survives is a camera roll of UPI screens and photographed bills. This is the
   way back in: an assistant reads the screenshots, this reads what it wrote,
   and a table stands between the two and the ledger.

   The parsing and editing are entirely client-side — the pasted text never
   reaches the server until a person presses Import, and then only as the
   fields it has been reduced to.
   =========================================================================== */

export default async function ImportPage() {
  // `nowIST()` is the only clock the app reads, and it reads it here so a
  // device with a wrong date cannot timestamp an import.
  const snap = await getSnapshot();

  return (
    <Page>
      <PageHeader
        title="Import a batch"
        subtitle="Paste several entries at once — from screenshots, a statement, or a spreadsheet"
      />
      <ImportClient
        methods={[...ALL_METHODS]}
        categories={[...ALL_CATEGORIES]}
        serverNow={nowIST()}
        entryCount={snap.transactions.filter((t) => !t.deleted).length}
      />
    </Page>
  );
}
