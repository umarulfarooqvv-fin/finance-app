import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSnapshot } from '@/lib/snapshot';
import { cycleOverridesFrom, recentCycles } from '@/lib/cycles';
import { misfiledCandidates } from '@/lib/misfiled';
import { reconcileRecorded } from '@/lib/reconcile';
import { dayOf, formatDay } from '@/lib/time';
import { round2 } from '@/lib/money';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Panel, cx } from '@/components/ui/primitives';
import { MisfiledPanel } from '@/app/reconcile/misfiled-panel';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   One cycle, nothing else.

   The card's own page has to hold a balance, the bill arithmetic, a bank
   check, two ledgers and this list, so this list gets a corner of it and a
   ceiling on its height. Closing a bill is not a corner-of-the-page job: it is
   reading a hundred rows against one figure, and it wants the screen.

   So the same list, alone, with the coverage bar frozen at the top — the
   figure being closed stays in view while the rows that close it scroll under
   it. Everything else about it is identical, because it IS the same component.
   =========================================================================== */

const CYCLES_OFFERED = 12;

export default async function CycleReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ cycle?: string }>;
}) {
  const { name } = await params;
  const sp = await searchParams;
  const cardName = decodeURIComponent(name);

  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);
  const card = snap.cards.find((c) => c.name === cardName);
  if (!card) notFound();

  const overrides = cycleOverridesFrom(snap.config);
  const cycles = recentCycles(card, today, CYCLES_OFFERED, overrides);
  const cycle = cycles.find((c) => c.statementEnd === sp.cycle) ?? cycles[0]!;

  const entries = misfiledCandidates(snap, card, cycle, overrides);

  /* The bank's own figure for THIS cycle, when it has been entered. Without it
     the bar would measure the app against itself and read 100% whatever the
     truth, so it is simply not drawn. */
  const checked = reconcileRecorded(snap, card).find(
    (r) => r.statementDate === cycle.statementEnd,
  );
  const billed = checked
    ? {
        actual: checked.actual,
        recorded: checked.current === 'inclusive' ? checked.inclusive : checked.exclusive,
        shortfall: round2(
          checked.actual - (checked.current === 'inclusive' ? checked.inclusive : checked.exclusive),
        ),
      }
    : null;

  const href = (c: string) =>
    `/cards/${encodeURIComponent(card.name)}/cycle?cycle=${encodeURIComponent(c)}`;

  return (
    <Page>
      <PageHeader
        title={`${card.name} · ${formatDay(cycle.statementEnd)}`}
        subtitle={`Paid with something else · ${formatDay(cycle.cycleStart)} to ${formatDay(cycle.periodEnd)}`}
        action={
          <Link
            href={`/cards/${encodeURIComponent(card.name)}`}
            className="rounded-[var(--radius-field)] border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-line-strong)]"
          >
            Back to card
          </Link>
        }
      />

      {/* Which bill is being worked. A misfiled spend is often noticed a month
          after the statement it belongs to, so the cycle has to be reachable
          without going back to the card and in again. */}
      <Panel className="mb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
            Statement
          </span>
          {cycles.map((c) => (
            <Link
              key={c.statementEnd}
              href={href(c.statementEnd)}
              className={cx(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                c.statementEnd === cycle.statementEnd
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)]',
              )}
            >
              {formatDay(c.statementEnd)}
            </Link>
          ))}
        </div>
      </Panel>

      {entries.elsewhere.length === 0 ? (
        <Panel>
          <p className="text-sm text-[var(--color-ink-2)]">
            Everything in this period was already paid with {card.name}. There is nothing here that
            could be a spend filed against the wrong method.
          </p>
        </Panel>
      ) : (
        <MisfiledPanel
          variant="page"
          candidates={entries.elsewhere}
          own={entries.own}
          billed={billed}
          card={card.name}
          toStatement={cycle.statementEnd}
        />
      )}
    </Page>
  );
}
