import Link from 'next/link';
import { getSnapshot } from '@/lib/snapshot';
import { recentCycles } from '@/lib/cycles';
import { dayOf, endOfDay, formatDay, startOfDay } from '@/lib/time';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Panel, cx } from '@/components/ui/primitives';
import { couldBelongToCard, type AppEntry } from '@/lib/statement-match';
import { ALL_METHODS } from '@/lib/types';
import { ReconcileClient, type MisfiledCandidate } from './reconcile-client';
import { MisfiledPanel } from './misfiled-panel';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Matching a pasted statement against what the app recorded.

   The server's only job here is to hand over the entries for one card and one
   statement period, stripped to what the matcher needs. THE PASTED STATEMENT
   NEVER REACHES THE SERVER: parsing and matching are pure functions, so they
   run in the browser, and a document full of card transactions stays on the
   device it was pasted into.
   =========================================================================== */

const CYCLES_OFFERED = 12;

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string; cycle?: string }>;
}) {
  const sp = await searchParams;
  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);

  const cards = snap.cards.filter((c) => c.active);
  const card = cards.find((c) => c.name === sp.card) ?? cards[0];

  if (!card) {
    return (
      <Page>
        <PageHeader title="Check a statement" subtitle="No cards are configured" />
      </Page>
    );
  }

  const overrides = (snap.config['cycleOverrides'] ?? {}) as Parameters<typeof recentCycles>[3];
  const cycles = recentCycles(card, today, CYCLES_OFFERED, overrides);
  const cycle = cycles.find((c) => c.statementEnd === sp.cycle) ?? cycles[0]!;

  /* The window is the statement's own period — cycleStart to periodEnd, which
     already accounts for whether the bill date's own spending was included. */
  const lo = startOfDay(cycle.cycleStart);
  const hi = endOfDay(cycle.periodEnd);

  const entries: AppEntry[] = snap.transactions
    .filter(
      (t) =>
        !t.deleted && t.ts && t.amount != null &&
        t.cardAffected === card.name && t.ts >= lo && t.ts <= hi,
    )
    .map((t) => ({
      id: t.id,
      ts: t.ts!,
      day: t.ts!.slice(0, 10),
      amount: t.amount ?? 0,
      description: t.remarks || t.category,
      // A charge raises the balance; a payment or refund lowers it.
      direction: t.cardDirection === 'debt-' ? ('credit' as const) : ('debit' as const),
      verified: t.verified,
    }))
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));

  /* Entries in the same window PAID WITH SOMETHING ELSE.

     A spend put on the wrong card is invisible exactly where you would notice
     it: it never shows on the statement you are checking, because this view
     filters by the card it was filed under. These are the rows that could be
     the missing one, and moving one across is a click.

     Which rows qualify is `couldBelongToCard`, kept pure and tested beside the
     matcher: the clauses that keep a row already counted against this card,
     and another card's bill payment, out of a list offering to re-file things
     onto it. On the live 6 Sep window they drop 5 rows carrying 68,456.03. */
  const elsewhere: MisfiledCandidate[] = snap.transactions
    .filter(
      (t) =>
        !t.deleted && t.ts && t.amount != null &&
        couldBelongToCard(t, card.name) &&
        t.ts >= lo && t.ts <= hi,
    )
    .map((t) => ({
      id: t.id,
      ts: t.ts!,
      day: t.ts!.slice(0, 10),
      amount: t.amount ?? 0,
      description: t.remarks || t.category,
      category: t.category,
      direction: t.cardDirection === 'debt-' ? ('credit' as const) : ('debit' as const),
      verified: t.verified,
      method: t.method,
    }))
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));

  const href = (over: { card?: string; cycle?: string }) => {
    const p = new URLSearchParams({ card: card.name, cycle: cycle.statementEnd, ...over });
    return `/reconcile?${p.toString()}`;
  };

  return (
    <Page>
      <PageHeader
        title="Check a statement"
        subtitle={`${card.name} · ${formatDay(cycle.cycleStart)} to ${formatDay(cycle.periodEnd)}`}
        action={
          <Link
            href={`/cards/${encodeURIComponent(card.name)}`}
            className="rounded-[var(--radius-field)] border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-line-strong)]"
          >
            Card detail
          </Link>
        }
      />

      <Panel className="mb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
            Card
          </span>
          {cards.map((c) => (
            <Link key={c.name} href={href({ card: c.name, cycle: undefined })} className={chip(c.name === card.name)}>
              {c.name}
            </Link>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)] pt-3">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
            Statement
          </span>
          {cycles.map((c) => (
            <Link
              key={c.statementEnd}
              href={href({ cycle: c.statementEnd })}
              className={chip(c.statementEnd === cycle.statementEnd)}
            >
              {formatDay(c.statementEnd)}
            </Link>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
          The window is this statement&rsquo;s own period, {formatDay(cycle.cycleStart)} to{' '}
          {formatDay(cycle.periodEnd)} — which already reflects whether the bill date&rsquo;s own
          spending was counted on it. {entries.length}{' '}
          {entries.length === 1 ? 'entry is' : 'entries are'} recorded in that window.
        </p>
      </Panel>

      <MisfiledPanel candidates={elsewhere} card={card.name} />

      <ReconcileClient
        entries={entries}
        elsewhere={elsewhere}
        methods={[...ALL_METHODS]}
        card={card.name}
        periodYear={Number(cycle.periodEnd.slice(0, 4))}
      />
    </Page>
  );
}

function chip(active: boolean): string {
  return cx(
    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
    active
      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
      : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)]',
  );
}
