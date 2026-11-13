import { getSnapshot } from '@/lib/snapshot';
import { currentSnapshot } from '@/lib/views';
import { familyFrom, familyView } from '@/lib/family';
import { Page, PageHeader } from '@/components/layout/page-header';
import { FamilyClient } from './family-client';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Family — costs shared between brothers (lib/family).

   The owner's part comes from the ledger (entries matched by a group's words
   or tags); a brother's part is typed in here. Each group says what each
   person paid against their share — an equal split of a shared cost, or a
   fixed monthly pledge like the car — and the summary adds up the groups
   marked to be counted.
   =========================================================================== */

export default async function FamilyPage() {
  await getSnapshot();
  const { snap, today } = await currentSnapshot();
  const { cfg, saved } = familyFrom(snap.config);
  const view = familyView(snap, cfg, today);

  return (
    <Page>
      <PageHeader title="Family" subtitle="Costs shared between brothers — who paid, and each one’s share" />
      <FamilyClient view={view} cfg={cfg} saved={saved} today={today} />
    </Page>
  );
}
