import { getSnapshot } from '@/lib/snapshot';
import { currentSnapshot } from '@/lib/views';
import { entriesInSplits, splitsFrom, splitView } from '@/lib/splits';
import { addDays } from '@/lib/time';
import { Page, PageHeader } from '@/components/layout/page-header';
import { SplitsClient } from './splits-client';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Splits — trips and meals out with friends (lib/splits).

   Each split: who was in it, what each paid (yours from your entries by tag,
   theirs typed in), each expense shared equally among the people it was for,
   and at the end the fewest payments that settle everyone.
   =========================================================================== */

export default async function SplitsPage() {
  await getSnapshot();
  const { snap, today } = await currentSnapshot();
  const splits = splitsFrom(snap.config);
  const views = [...splits].sort((a, b) => (a.day < b.day ? 1 : -1)).map((s) => splitView(snap, s));

  /* Your Credit Given entries not yet in any split — how you log paying for
     the group first — offered to be picked into one. Half a year back. */
  const taken = entriesInSplits(snap, splits);
  const since = addDays(today, -183);
  const candidates = snap.transactions
    .filter((t) => !t.deleted && t.ts && t.amount != null && t.category === 'Credit Given' && t.ts.slice(0, 10) >= since && !taken.has(t.id))
    .sort((a, b) => (a.ts! < b.ts! ? 1 : -1))
    .slice(0, 100)
    .map((t) => ({ id: t.id, day: t.ts!.slice(0, 10), amount: t.amount!, remarks: t.remarks, method: t.method }));

  // The tags you have used, most recent first: a trip is usually one.
  const lastUse = new Map<string, string>();
  for (const t of snap.transactions) {
    if (t.deleted || !t.ts) continue;
    for (const g of t.userTags) if ((lastUse.get(g) ?? '') < t.ts) lastUse.set(g, t.ts);
  }
  const tags = [...lastUse.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 12).map(([g]) => g);

  return (
    <Page>
      <PageHeader title="Splits" subtitle="Trips and meals with friends — who paid, and who pays whom" />
      <SplitsClient views={views} tags={tags} today={today} candidates={candidates} />
    </Page>
  );
}
