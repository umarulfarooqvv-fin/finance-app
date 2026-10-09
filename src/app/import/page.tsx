import { tagNames } from '@/lib/tag-summary';
import { getSnapshot } from '@/lib/snapshot';
import { nowIST } from '@/lib/time';
import { ALL_CATEGORIES, ALL_METHODS, INCOME_ACCOUNTS, INCOME_SOURCES } from '@/lib/types';
import { creditLedger } from '@/lib/credit';
import { bankMethodsFrom } from '@/lib/bank-methods';
import { visionConfig } from '@/lib/ai/vision';
import { describeUsage } from '@/lib/ai/usage';
import { readAiUsage } from '@/lib/ai/usage-store';
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
  const vision = visionConfig();
  const [snap, usage] = await Promise.all([
    getSnapshot(),
    vision.name !== 'off' ? readAiUsage() : Promise.resolve(null),
  ]);
  const aiUsage = vision.name !== 'off' ? describeUsage(usage, nowIST()) : null;

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
        bankMethods={bankMethodsFrom(snap.config)}
        entryCount={snap.transactions.filter((t) => !t.deleted).length}
        visionEnabled={vision.name !== 'off'}
        visionLabel={vision.label}
        aiUsage={aiUsage}
        tagList={tagNames(snap)}
        incomeAccounts={[...INCOME_ACCOUNTS]}
        incomeSources={[...INCOME_SOURCES]}
        debtors={creditLedger(snap).people
          .filter((p) => !p.settled && p.outstanding > 0.005)
          .sort((a, b) => a.person.localeCompare(b.person))
          .map((p) => ({ person: p.person, outstanding: p.outstanding }))}
        existingIncome={snap.income
          .filter((i) => !i.deleted && i.ts && i.amount != null)
          .map((i) => ({ day: i.ts!.slice(0, 10), amount: i.amount!, account: i.account, source: i.source, remarks: i.remarks }))}
      />
    </Page>
  );
}
