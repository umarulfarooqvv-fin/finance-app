import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getSnapshot } from '@/lib/snapshot';
import { creditLedger } from '@/lib/credit';
import { creditPeople } from '@/lib/credit-view';
import { Page, PageHeader } from '@/components/layout/page-header';
import { CreditClient } from './credit-client';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Credit given — every lending, searchable by person or by what it was for,
   with the total for whatever is on screen. The Ledgers page shows the top
   balances; this is where the whole list is read.
   =========================================================================== */

export default async function CreditGivenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const snap = await getSnapshot();
  const people = creditPeople(creditLedger(snap), snap);

  return (
    <Page>
      <Link
        href="/ledgers"
        className="mb-3 inline-flex items-center gap-1 text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Ledgers
      </Link>
      <PageHeader title="Credit given" subtitle="Search by person or by what it was for — the totals follow" />
      <CreditClient people={people} initialQuery={q} />
    </Page>
  );
}
