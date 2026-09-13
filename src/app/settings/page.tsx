import { getSnapshot } from '@/lib/snapshot';
import { cardColor } from '@/lib/statement';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Panel, SectionTitle } from '@/components/ui/primitives';
import { AccountSettings, CardSettings } from './settings-client';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   The configuration every other figure is computed from — now editable.

   It was read-only, which made the Money page a dead end: it told you to set
   an opening balance, linked here, and here showed you a number you could not
   change. Writes go through guardedAction like every other mutation, so the
   session check, validation, audit line and cache invalidation are the same
   ones the transaction forms get.
   =========================================================================== */

export default async function SettingsPage() {
  const snap = await getSnapshot();
  const needsReview = snap.transactions.filter((t) => t.needsReview).length;
  const cards = snap.cards.map((c) => ({ ...c, color: cardColor(c.slot) }));

  return (
    <Page>
      <PageHeader title="Settings" subtitle="The configuration every figure is computed from" />

      <Panel>
        <SectionTitle>Cards</SectionTitle>
        <CardSettings cards={cards} />
        <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
          The opening balance stands in for debt carried before tracking began. Rows older than the
          tracked-from date are skipped so that history is not counted twice.
        </p>
      </Panel>

      <Panel className="mt-4">
        <SectionTitle>Accounts</SectionTitle>
        <AccountSettings accounts={snap.accounts} />
        <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
          There is no bank connection. A balance is reconstructed as the opening figure plus income
          recorded since, minus everything paid out of the account since — so it is only as accurate
          as the logging. Setting a recent date and the balance on that date is what makes the Money
          page meaningful.
        </p>
      </Panel>

      <Panel className="mt-4">
        <SectionTitle>Data</SectionTitle>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">Transactions</dt>
            <dd className="num mt-0.5 font-semibold">{snap.transactions.length.toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">Income rows</dt>
            <dd className="num mt-0.5 font-semibold">{snap.income.length.toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">Store version</dt>
            <dd className="num mt-0.5 font-semibold">{snap.version}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">Loaded at</dt>
            <dd className="num mt-0.5 text-xs">{snap.loadedAt.replace('T', ' ')}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
          {needsReview} {needsReview === 1 ? 'row' : 'rows'} could not be fully classified — usually a
          blank amount or an unrecognised category.
        </p>
      </Panel>
    </Page>
  );
}
