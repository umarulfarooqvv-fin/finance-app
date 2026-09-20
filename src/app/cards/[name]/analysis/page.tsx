import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSnapshot } from '@/lib/snapshot';
import { analyseCard } from '@/lib/card-analysis';
import { addDays, dayOf, formatDay, formatDayShort } from '@/lib/time';
import { Page, PageHeader } from '@/components/layout/page-header';
import {
  Badge, Empty, Money, Panel, SectionTitle, Stat, StatGrid, cx,
} from '@/components/ui/primitives';
import { RankedBars } from '@/components/charts/charts';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Where a card's charges went.

   The card page answers "what do I owe". This answers the question underneath
   it, and leads with the split that decides whether the number above is
   alarming: how much of this balance is spending, and how much is money lent
   out that is coming back.
   =========================================================================== */

const WINDOWS = [
  { key: '3m', label: '3 months', days: 90 },
  { key: '12m', label: '12 months', days: 365 },
  { key: 'all', label: 'All time', days: null },
] as const;

export default async function CardAnalysisPage({
  params, searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const { name } = await params;
  const sp = await searchParams;
  const cardName = decodeURIComponent(name);

  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);
  const card = snap.cards.find((c) => c.name === cardName);
  if (!card) notFound();

  const win = WINDOWS.find((w) => w.key === sp.window) ?? WINDOWS[1];
  const from = win.days === null ? (card.openingDate || '2000-01-01') : addDays(today, -win.days);

  const a = analyseCard(snap, card.name, from, today);

  const href = (w: string) =>
    `/cards/${encodeURIComponent(card.name)}/analysis?window=${w}`;

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <Page>
      <PageHeader
        title={`${card.name} · where it went`}
        subtitle={`${formatDay(a.from)} to ${formatDay(a.to)} · ${a.charges.count} charges`}
        action={
          <Link
            href={`/cards/${encodeURIComponent(card.name)}`}
            className="rounded-[var(--radius-field)] border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-line-strong)]"
          >
            Back to card
          </Link>
        }
      />

      <Panel className="mb-4">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {WINDOWS.map((w) => (
            <Link
              key={w.key}
              href={href(w.key)}
              className={cx(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                w.key === win.key
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)]',
              )}
            >
              {w.label}
            </Link>
          ))}
        </div>

        <StatGrid cols={4}>
          <Stat label="Charged to the card" value={a.charges.total} tone="debt" />
          <Stat
            label="Of that, spending"
            value={a.spend.total}
            hint={a.charges.total > 0 ? pct(a.spend.total / a.charges.total) : undefined}
          />
          <Stat
            label="Still owed to you"
            value={a.credit.outstanding}
            tone={a.credit.outstanding > 0.005 ? 'debt' : 'credit'}
            hint={a.credit.given > 0.005 ? `of ${a.credit.given.toFixed(0)} lent` : 'nothing lent'}
          />
          <Stat
            label="The card's own cost"
            value={a.cost.total}
            tone={a.cost.total > 0.005 ? 'debt' : 'neutral'}
            hint="fees, surcharges and tax"
          />
        </StatGrid>
      </Panel>

      {/* ---- The split that decides whether the balance is alarming ------ */}
      <Panel className="mb-4">
        <SectionTitle>Where the charges went</SectionTitle>
        <p className="mb-3 text-xs text-[var(--color-ink-2)]">
          A card can sit at its limit entirely on money that is owed back. This is that split,
          before any of it is called spending.
        </p>
        <RankedBars data={a.byKind} limit={6} onEmpty="Nothing was charged in this period." />
      </Panel>

      <Panel className="mb-4">
        <SectionTitle>Spending by category &middot; {a.spend.count}</SectionTitle>
        <p className="mb-3 text-xs text-[var(--color-ink-2)]">
          Consumption only. Lending, bill payments and transfers into savings are left out &mdash;
          counting them here is what makes a month with three bill payments look like a disaster.
        </p>
        <RankedBars data={a.byCategory} limit={12} onEmpty="No spending on this card in this period." />
      </Panel>

      <Panel className="mb-4">
        <SectionTitle>Biggest charges &middot; {a.largest.length}</SectionTitle>
        {a.largest.length === 0 ? (
          <Empty title="Nothing charged" hint="Pick a longer window above." />
        ) : (
          <ul className="flex flex-col">
            {a.largest.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0"
              >
                <span className="num w-20 shrink-0 text-xs text-[var(--color-ink-3)]">
                  {formatDayShort(t.ts!.slice(0, 10))}
                </span>
                <span className="min-w-0 flex-1 truncate">{t.remarks || t.category}</span>
                <Badge tone={t.kind === 'credit_given' ? 'warn' : 'neutral'}>{t.category}</Badge>
                <Money value={t.amount ?? 0} size="sm" tone="debt" />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ---- Lending, and whether it came back --------------------------- */}
      {a.credit.people.length > 0 ? (
        <Panel className="mb-4">
          <SectionTitle>Lent on this card &middot; {a.credit.people.length}</SectionTitle>
          <p className="mb-3 text-xs text-[var(--color-ink-2)]">
            Repayment is read from the Ledgers engine, which settles oldest charges first &mdash;
            so &ldquo;still owed&rdquo; means the same here as it does there.
          </p>
          <ul className="flex flex-col">
            {a.credit.people.map((p) => (
              <li
                key={p.person}
                className={cx(
                  'flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0',
                  p.settled && 'bg-[var(--color-pos-soft)]',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{p.person}</span>
                {p.settled ? (
                  <Badge tone="good">Cleared</Badge>
                ) : (
                  <Badge tone="warn">
                    {p.given > 0 ? pct(p.repaid / p.given) : '0%'} back
                  </Badge>
                )}
                <span className="shrink-0 text-[11px] text-[var(--color-ink-3)]">
                  lent <Money value={p.given} size="sm" />
                </span>
                <Money
                  value={p.outstanding}
                  size="sm"
                  tone={p.settled ? 'credit' : 'debt'}
                  className="font-semibold"
                />
              </li>
            ))}
            <li className="flex items-center justify-between gap-2 pt-2 text-xs">
              <span className="text-[var(--color-ink-3)]">Still owed to you</span>
              <Money
                value={a.credit.outstanding}
                size="sm"
                tone={a.credit.outstanding > 0.005 ? 'debt' : 'credit'}
                className="font-semibold"
              />
            </li>
          </ul>
        </Panel>
      ) : null}

      {/* ---- The rest, folded, because most visits want the four above --- */}
      <details className="rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-surface)]">
        <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-[var(--color-ink-2)] marker:text-[var(--color-ink-3)]">
          Month by month, and what repeats
        </summary>
        <div className="border-t border-[var(--color-line)] p-4 pt-3">
          <Panel>
            <SectionTitle>Month by month</SectionTitle>
            {a.monthly.length === 0 ? (
              <Empty title="Nothing to chart" />
            ) : (
              <ul className="flex flex-col">
                {a.monthly.map((m) => (
                  <li
                    key={m.month}
                    className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0"
                  >
                    <span className="num w-20 shrink-0 text-xs text-[var(--color-ink-3)]">{m.month}</span>
                    <div className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--color-raised)]">
                      <div
                        className="bg-[var(--color-accent)]"
                        style={{ width: `${m.charges > 0 ? (m.spend / m.charges) * 100 : 0}%` }}
                      />
                      <div
                        className="bg-[var(--color-warn)]"
                        style={{ width: `${m.charges > 0 ? (m.lent / m.charges) * 100 : 0}%` }}
                      />
                    </div>
                    {m.lent > 0.005 ? (
                      <span className="shrink-0 text-[11px] text-[var(--color-ink-3)]">
                        lent <Money value={m.lent} size="sm" />
                      </span>
                    ) : null}
                    <Money value={m.charges} size="sm" tone="debt" />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
              The bar splits each month into spending and lending. A month with no charges is
              absent rather than drawn as zero &mdash; a gap in the history is not a quiet month.
            </p>
          </Panel>

          <Panel className="mt-4">
            <SectionTitle>Charges that repeat &middot; {a.repeats.length}</SectionTitle>
            {a.repeats.length === 0 ? (
              <Empty title="Nothing repeats" hint="No description appears twice in this window." />
            ) : (
              <ul className="flex flex-col">
                {a.repeats.map((r) => (
                  <li
                    key={r.name}
                    className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <Badge tone="neutral">&times;{r.count}</Badge>
                    <span className="shrink-0 text-[11px] text-[var(--color-ink-3)]">
                      <Money value={r.each} size="sm" /> each
                    </span>
                    <Money value={r.total} size="sm" tone="debt" />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
              Instalments are left out &mdash; an EMI is one commitment under many names, and the
              EMI tracker groups it properly.
            </p>
          </Panel>
        </div>
      </details>
    </Page>
  );
}
