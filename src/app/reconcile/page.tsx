import Link from 'next/link';
import { getSnapshot } from '@/lib/snapshot';
import { cycleOf, recentCycles } from '@/lib/cycles';
import { dayOf, endOfDay, formatDay, startOfDay } from '@/lib/time';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Panel, cx } from '@/components/ui/primitives';
import { couldBelongToCard } from '@/lib/statement-match';
import { cardColor } from '@/lib/statement';
import { ALL_METHODS, isCard } from '@/lib/types';
import { ReconcileClient, type CardEntry, type MisfiledCandidate } from './reconcile-client';
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

  // A full Card structurally satisfies CycleCard too, so one map serves both
  // the cycle maths and the colour lookup.
  const cardsByName = new Map(snap.cards.map((c) => [c.name, c]));

  /* Each card's own colour, so a row reads as "which card" at a glance instead
     of by parsing its badge text — the same dot used on Today and Cards.
     Resolved here rather than handed to the client as `cardColor` itself: a
     function is not serialisable across the server/client boundary, and
     passing one silently fails at runtime with no typecheck to catch it. A
     non-card method (Fi, Cash) has no card and so no colour. */
  const colorOf = (method: string): string | null => {
    const c = cardsByName.get(method);
    return c ? cardColor(c.slot) : null;
  };

  const entries: CardEntry[] = snap.transactions
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
      /* Where the money came FROM. Usually this card — a spend charged to a
         card IS filed against it, so the two agree. The exception is a bill
         payment: it lands ON this card but is paid FROM a bank account, so its
         method is that account. Carrying it lets the matched list say which,
         instead of leaving every row to be assumed. */
      method: t.method,
      methodColor: colorOf(t.method),
    }))
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));

  /* EVERY CARD BILLS ON A DIFFERENT DAY — Edge on the 6th, Scapia the 14th,
     One Card the 22nd, Coral the 25th. So an entry sitting on Scapia is on a
     Scapia statement with its own dates, and moving it to Edge does not just
     change a label: it takes the charge off one bill and puts it on another
     that was cut on a different day.

     Reading it off the row is the only way to know which bill is about to
     change. `cycleOf` answers it from the entry's own timestamp, using that
     card's bill date and boundary, and inactive cards are included because an
     old entry can still be sitting on one. A non-card method has no statement
     at all, which is itself worth showing rather than leaving blank. */
  const statementOf = (method: string, ts: string): string | null => {
    if (!isCard(method)) return null;
    const c = cardsByName.get(method);
    return c ? cycleOf(c, ts, overrides).statementEnd : null;
  };

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
      methodColor: colorOf(t.method),
      fromStatement: statementOf(t.method, t.ts!),
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

      <MisfiledPanel candidates={elsewhere} card={card.name} toStatement={cycle.statementEnd} />

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
