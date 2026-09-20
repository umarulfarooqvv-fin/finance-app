import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSnapshot } from '@/lib/snapshot';
import { creditLedger } from '@/lib/credit';
import { cardColor, cardDetail, statementHistory, type LedgerEntry } from '@/lib/statement';
import { reconcileRecorded, recentStatementDates } from '@/lib/reconcile';
import { cycleOverridesFrom } from '@/lib/cycles';
import { ReconcileClient } from './reconcile-client';
import { misfiledCandidates } from '@/lib/misfiled';
import { MisfiledPanel } from '@/app/reconcile/misfiled-panel';
import { dayOf, formatDay, formatDayShort, relativeDays } from '@/lib/time';
import { money, percent } from '@/lib/format';
import { round2 } from '@/lib/money';
import { Page, PageHeader } from '@/components/layout/page-header';
import {
  Badge, Dot, Empty, Meter, Money, Panel, SectionTitle, Stat, StatGrid, TableWrap, Td, Th,
} from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   One card in full (spec §3.3): the bill, the balance still building, the
   cycle arithmetic written out, and the reconciliation split.
   =========================================================================== */

function Ledger({ entries, empty }: { entries: LedgerEntry[]; empty: string }) {
  if (entries.length === 0) return <Empty title={empty} />;

  return (
    <TableWrap>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Description</Th>
          <Th>Category</Th>
          <Th align="right">Debit</Th>
          <Th align="right">Credit</Th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <Td className="whitespace-nowrap text-xs text-[var(--color-ink-2)]">
              {formatDayShort(e.day)}
            </Td>
            <Td>
              <span className="flex items-center gap-2">
                <span className="truncate">{e.description}</span>
                {e.verified ? (
                  <span
                    className="text-[var(--color-pos)]"
                    title="Matched against the bank statement"
                    aria-label="Verified"
                  >
                    ✓
                  </span>
                ) : null}
              </span>
            </Td>
            <Td className="text-xs text-[var(--color-ink-3)]">{e.category}</Td>
            <Td align="right">{e.debit ? <Money value={e.debit} size="sm" /> : null}</Td>
            <Td align="right">
              {e.credit ? <Money value={e.credit} size="sm" tone="credit" /> : null}
            </Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

export default async function CardPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const cardName = decodeURIComponent(name);

  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);
  const card = snap.cards.find((c) => c.name === cardName);
  if (!card) notFound();

  const { row, billed, unbilled } = cardDetail(snap, card, today);

  /* The same hunting ground the statement checker offers, on the page that
     already reports the shortfall. "The bank billed 6,070.95 more than
     anything recorded here accounts for" is stated a few panels down, and a
     spend typed against the wrong method is the commonest reason for it — so
     the list to search is here rather than a page away. Same builder, same
     rules, same answer. */
  const overrides = cycleOverridesFrom(snap.config);
  const cycleEntries = misfiledCandidates(snap, card, row.cycle, overrides);

  /* Every cycle this card has had, so a balance that should be zero can be
     traced to the month it started rather than guessed at. */
  const history = statementHistory(
    snap, card, today, creditLedger(snap).outstandingByTx, overrides,
  );

  // Whether any statement on this card has had its summary box recorded.
  const checkedAny = history.some((h) => h.bank !== null);
  const recorded = reconcileRecorded(snap, card);
  const statementDates = recentStatementDates(card, today, 6);
  /* The bank's own figure for the cycle on screen, when it has been entered
     through "Check against the bank". Without it there is nothing to measure
     against — the app compared to itself always agrees — so the bar is simply
     not drawn. `current` picks the total under the boundary actually in force,
     which is the number the rest of the page is showing. */
  const checkedCycle = recorded.find((r) => r.statementDate === row.cycle.statementEnd);
  const billCheck = checkedCycle
    ? {
        actual: checkedCycle.actual,
        recorded: checkedCycle.current === 'inclusive'
          ? checkedCycle.inclusive
          : checkedCycle.exclusive,
        shortfall: round2(
          checkedCycle.actual
            - (checkedCycle.current === 'inclusive' ? checkedCycle.inclusive : checkedCycle.exclusive),
        ),
      }
    : null;

  const m = row.cycleMath;
  const checked = row.verified.verified + row.verified.unverified;

  return (
    <Page>
      <PageHeader
        title={card.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Bills on the {card.billDate}{ordinal(card.billDate)} · statement {formatDay(row.cycle.statementEnd)}</span>
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            {/* The main thing anyone comes to a card page to do once the bill
                arrives, and until now it was only reachable from the nav. It
                leads with the cycle this page is already showing, so the check
                opens on the bill being looked at rather than on the newest. */}
            <Link
              href={`/reconcile?card=${encodeURIComponent(card.name)}&cycle=${encodeURIComponent(row.cycle.statementEnd)}`}
              className="rounded-[var(--radius-field)] bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90"
            >
              Check a statement
            </Link>
            <Link
              href="/cards"
              className="rounded-[var(--radius-field)] border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-line-strong)]"
            >
              All cards
            </Link>
          </div>
        }
      />

      <Panel>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
              <Dot color={cardColor(card.slot)} />
              Total balance now
            </div>
            <Money value={row.totalDebtLive} size="display" className="mt-1 block" />
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              {row.remainingDueBill > 0 ? (
                <>
                  <strong className="sensitive font-semibold text-[var(--color-ink)]">
                    {money(row.remainingDueBill)}
                  </strong>{' '}
                  due {formatDay(row.cycle.dueDate)} · {relativeDays(row.daysLeft)}
                </>
              ) : (
                <>Bill cleared. Next statement {formatDay(row.cycle.nextStatementEnd)}.</>
              )}
            </p>
          </div>
          {row.status === 'overdue' ? (
            <Badge tone="bad">Overdue</Badge>
          ) : row.status === 'due-soon' ? (
            <Badge tone="warn">{row.daysLeft === 0 ? 'Due today' : `${row.daysLeft}d left`}</Badge>
          ) : row.status === 'paid' ? (
            <Badge tone="good">Paid</Badge>
          ) : (
            <Badge tone="neutral">On track</Badge>
          )}
        </div>

        <div className="mt-5 border-t border-[var(--color-line)] pt-4">
          <StatGrid cols={4}>
            <Stat label="On this bill" value={row.remainingDueBill} />
            <Stat label="Unbilled since" value={row.unbilled} />
            <Stat
              label="Utilisation"
              value={row.totalDebtLive <= 0 ? 'Nothing owed' : percent(row.utilization)}
              hint={
                card.creditLimit > 0 ? (
                  <>of <span className="sensitive">{money(card.creditLimit, { whole: true })}</span></>
                ) : (
                  'No limit set'
                )
              }
            />
            <Stat
              label="Lent to others"
              value={row.creditGivenOutstanding}
              hint="Still unpaid, excluded from your own debt"
              tone="muted"
            />
          </StatGrid>
          <div className="mt-3">
            <Meter value={row.utilization} label={`${card.name} utilisation`} />
          </div>
        </div>
      </Panel>

      {/* ---- Cycle arithmetic, written out ------------------------------- */}
      <Panel className="mt-4">
        <SectionTitle>How this bill was built</SectionTitle>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
          <span className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-2.5 py-1.5">
            <span className="text-[11px] text-[var(--color-ink-3)]">Opening </span>
            <Money value={m.openingBalance} size="sm" />
          </span>
          <span className="text-[var(--color-ink-3)]">+</span>
          <span className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-2.5 py-1.5">
            <span className="text-[11px] text-[var(--color-ink-3)]">Spends </span>
            <Money value={m.cycleSpends} size="sm" />
          </span>
          <span className="text-[var(--color-ink-3)]">−</span>
          <span className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-2.5 py-1.5">
            <span className="text-[11px] text-[var(--color-ink-3)]">Payments </span>
            <Money value={m.cycleRepayments} size="sm" />
          </span>
          <span className="text-[var(--color-ink-3)]">=</span>
          <span className="rounded-[var(--radius-field)] bg-[var(--color-accent-soft)] px-2.5 py-1.5">
            <span className="text-[11px] text-[var(--color-accent)]">Closing </span>
            <Money value={m.closingBalance} size="sm" className="font-semibold" />
          </span>
        </div>
        <p className="mt-3 text-xs text-[var(--color-ink-3)]">
          Cycle ran {formatDay(row.cycle.cycleStart)} to {formatDay(row.cycle.periodEnd)}.
          {row.cycle.boundary === 'exclusive' ? (
            <>
              {' '}The statement is dated {formatDay(row.cycle.statementEnd)}, but was cut before
              that day&rsquo;s spending.
            </>
          ) : null}
        </p>
      </Panel>

      {/* ---- What IS on this bill, then what might be missing from it ----
           Ordered deliberately: the statement's own entries sit directly above
           the entries paid with something else, because the question the pair
           answers is whether anything in the second list belongs in the first.
           They were separated by two panels, which is a lot of scrolling to
           compare two lists. */}
      <Panel className="mt-4">
        <SectionTitle>
          On the {formatDay(row.cycle.statementEnd)} statement &middot; {billed.length}
        </SectionTitle>
        <Ledger entries={billed} empty="Nothing was billed in this cycle." />
      </Panel>

      {/* ---- Where a balance came from ----------------------------------- */}
      {history.length > 1 ? (
        <Panel className="mt-4">
          <SectionTitle>Statement history &middot; {history.length}</SectionTitle>
          <p className="mb-3 text-xs text-[var(--color-ink-2)]">
            Every cycle since {formatDay(card.openingDate ?? history[0]!.cycle.cycleStart)}.
            <strong className="font-medium text-[var(--color-ink)]"> Left over</strong> is what the
            previous bill was not paid off by — zero when a bill is cleared in full, so the first
            month it is not zero is where a balance you cannot account for began. Every month after
            it inherits the same figure without being a new mistake.
          </p>
          <TableWrap>
            <thead>
              <tr>
                <Th>Statement</Th>
                <Th align="right">Opening</Th>
                <Th align="right">Spends</Th>
                <Th align="right">Paid</Th>
                <Th align="right">Closing</Th>
                <Th align="right">Left over</Th>
                {/* Only worth a column once a statement has been recorded. */}
                {checkedAny ? <Th align="right">vs bank</Th> : null}
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr
                  key={h.cycle.statementEnd}
                  className={h.carriedIn > 0.005 ? 'bg-[var(--color-warn-soft)]' : undefined}
                >
                  <Td className="whitespace-nowrap text-xs">{formatDay(h.cycle.statementEnd)}</Td>
                  <Td align="right"><Money value={h.opening} size="sm" tone="muted" /></Td>
                  <Td align="right"><Money value={h.spends} size="sm" /></Td>
                  <Td align="right"><Money value={h.payments} size="sm" tone="credit" /></Td>
                  <Td align="right"><Money value={h.closing} size="sm" /></Td>
                  <Td align="right">
                    {h.carriedIn > 0.005 ? (
                      <Money value={h.carriedIn} size="sm" tone="debt" className="font-semibold" />
                    ) : (
                      <span className="text-xs text-[var(--color-ink-3)]">&mdash;</span>
                    )}
                  </Td>
                  {checkedAny ? (
                    <Td align="right">
                      {h.bank === null ? (
                        <span className="text-[11px] text-[var(--color-ink-3)]">not checked</span>
                      ) : Math.abs(h.bank.diff.due) < 0.005
                        && Math.abs(h.bank.diff.opening) < 0.005 ? (
                        <Badge tone="good">matches</Badge>
                      ) : (
                        /* Name the figure that disagrees, not just that one
                           does. An opening-balance gap means the error is in
                           an EARLIER cycle; a charges gap means it is here. */
                        <span className="flex flex-col items-end gap-0.5 text-[11px]">
                          {Math.abs(h.bank.diff.opening) >= 0.005 ? (
                            <span className="text-[var(--color-neg)]">
                              opening{' '}
                              <span className="sensitive num">
                                {h.bank.diff.opening > 0 ? '+' : ''}
                                {h.bank.diff.opening.toFixed(2)}
                              </span>
                            </span>
                          ) : null}
                          {Math.abs(h.bank.diff.charges) >= 0.005 ? (
                            <span className="text-[var(--color-neg)]">
                              charges{' '}
                              <span className="sensitive num">
                                {h.bank.diff.charges > 0 ? '+' : ''}
                                {h.bank.diff.charges.toFixed(2)}
                              </span>
                            </span>
                          ) : null}
                          {Math.abs(h.bank.diff.payments) >= 0.005 ? (
                            <span className="text-[var(--color-neg)]">
                              paid{' '}
                              <span className="sensitive num">
                                {h.bank.diff.payments > 0 ? '+' : ''}
                                {h.bank.diff.payments.toFixed(2)}
                              </span>
                            </span>
                          ) : null}
                        </span>
                      )}
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>
      ) : null}

      {/* ---- What has landed since the bill ------------------------------
           Only when something has. An empty panel headed "Still building ·
           0.00" says exactly what the balance card already says two screens
           up, in a whole panel of its own. */}
      {unbilled.length > 0 ? (
        <Panel className="mt-4">
          <SectionTitle>
            Still building · <span className="sensitive">{money(row.unbilled)}</span>
          </SectionTitle>
          <Ledger entries={unbilled} empty="Bill cleared. No new spends yet." />
        </Panel>
      ) : null}

      {/* ---- Everything a glance at a card never needs --------------------

           Folded, not removed, the same way the statement check folds its own.
           Deducing a cycle's cut-off from the bank's closing balance, sweeping
           other methods for a spend that was really on this card, and the
           verified-tick bar are all real tools on the day a bill does not
           add up — and clutter on the days it does, which is most of them. */}
      <details className="mt-4 rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-surface)]">
        <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-[var(--color-ink-2)] marker:text-[var(--color-ink-3)]">
          More tools
        </summary>
        <div className="border-t border-[var(--color-line)] p-4 pt-3">
          <Panel>
            <ReconcileClient
              card={card.name}
              statementDates={statementDates}
              recorded={recorded}
            />
          </Panel>

          <div className="mt-4">
            <MisfiledPanel
              candidates={cycleEntries.elsewhere}
              own={cycleEntries.own}
              billed={billCheck}
              fullViewHref={`/cards/${encodeURIComponent(card.name)}/cycle?cycle=${encodeURIComponent(row.cycle.statementEnd)}`}
              card={card.name}
              toStatement={row.cycle.statementEnd}
            />
          </div>

        <Panel className="mt-4">
          <SectionTitle>Reconciliation</SectionTitle>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex h-2 overflow-hidden rounded-full bg-[var(--color-raised)]">
                <div
                  className="bg-[var(--color-pos)]"
                  style={{ width: checked > 0 ? `${(row.verified.verified / checked) * 100}%` : '0%' }}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span className="text-[var(--color-pos)]">
                  <span className="sensitive">{money(row.verified.verified)}</span> verified
                </span>
                <span className="text-[var(--color-ink-3)]">
                  <span className="sensitive">{money(row.verified.unverified)}</span> unchecked
                </span>
              </div>
            </div>
          </div>
        </Panel>
        </div>
      </details>

    </Page>
  );
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}
