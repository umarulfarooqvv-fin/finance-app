'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { formatDayShort } from '@/lib/time';
import { money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { Badge, cx, Empty, Money } from '@/components/ui/primitives';
import { TransactionDialog, type EditableTransaction } from './transaction-dialog';
import { deleteTransactionAction, restoreTransactionAction } from './actions';

/* ===========================================================================
   The client island for the transaction list.

   The server component fetches, filters and strips; this owns interaction —
   the add/edit dialog, the delete confirmation, and the outcome messaging.
   =========================================================================== */

export type Row = EditableTransaction & {
  kind: string;
  verified: boolean;
  isFuture: boolean;
  deleted: boolean;
};

/** One calendar day's rows, with what that day actually cost. */
export type DayGroup = {
  day: string;
  /** Spend only - bill payments, lending and transfers are excluded. */
  spent: number;
  rows: Row[];
};

export function TransactionsClient({
  groups, defaultTs, nowIso, toolbar,
}: {
  /** Search, filters and the row-visibility links, rendered inside the frozen
      bar rather than in a panel of their own. They belong with New entry: one
      strip of controls that stays put over a list thousands of rows long. */
  toolbar?: ReactNode;
  groups: DayGroup[];
  defaultTs: string;
  nowIso: string;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EditableTransaction | null>(null);
  const [confirming, setConfirming] = useState<Row | null>(null);

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (r: Row) => { setEditing(r); setFormOpen(true); };

  function remove(row: Row) {
    startTransition(async () => {
      const result = await deleteTransactionAction({ id: row.id });
      if (!result.ok) { notify('error', result.error); return; }
      setConfirming(null);
      // Deleting money is worth an undo path, so the toast says what happened
      // and the row remains restorable — nothing is destroyed.
      notify('success', 'Entry deleted. It is kept in history and can be restored.');
      router.refresh();
    });
  }

  function restore(row: Row) {
    startTransition(async () => {
      const result = await restoreTransactionAction({ id: row.id });
      if (!result.ok) { notify('error', result.error); return; }
      notify('success', 'Entry restored.');
      router.refresh();
    });
  }

  /* The day headers stick UNDER the bar, not beneath the viewport's top, so
     they need its height — which changes with the viewport: the controls wrap
     onto more rows on a phone, and the "future rows are hidden" line comes and
     goes. Measured rather than guessed, because a hardcoded offset is wrong at
     every width except the one it was written for. */
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = barRef.current;
    const root = rootRef.current;
    if (!bar || !root) return;
    const sync = () => root.style.setProperty('--tx-bar-h', `${bar.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={rootRef}>
      {/* Frozen. Scrolling a list this long used to mean scrolling all the way
          back up to change a filter or add an entry. */}
      <div
        ref={barRef}
        /* The bar owns its own vertical padding rather than sitting inside the
           panel's. Once stuck, the panel's top padding has scrolled away with
           the panel, and a search field flush against the top of the screen is
           the result. Owning it means the same breathing room in both states.

           Rounded at the top to match the panel it is flush with, which also
           reads correctly once it detaches and floats. */
        className="sticky top-0 z-30 -mx-4 mb-3 rounded-t-[var(--radius-card)] border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 pb-3 pt-4 sm:-mx-5 sm:px-5 sm:pt-5"
      >
        {toolbar}
        {/* Desktop only. On a phone this row is 48px of PERMANENTLY frozen
            height for one button, and it puts that button in the hardest
            corner of the screen to reach — so there it lives above the thumb
            instead, at the foot of the page. */}
        <div className="mt-3 hidden justify-end lg:flex">
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New entry
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <Empty title="Nothing matches" hint="Try a different search, or add an entry." />
      ) : (
        <div className="flex flex-col">
          {/* Column labels only where there are columns. On a phone each row
              carries its own labels in a second line instead. */}
          <div className="hidden items-center gap-x-3 border-b border-[var(--color-line)] px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)] sm:flex">
            <span className="w-11 shrink-0">Time</span>
            <span className="min-w-0 flex-1">Description</span>
            <span className="w-28 shrink-0">Category</span>
            <span className="w-20 shrink-0">Method</span>
            <span className="w-24 shrink-0 text-right">Amount</span>
            <span className="w-[68px] shrink-0" />
          </div>

          {/* One section per day.

              This is a list, not a table, because the table could not be read
              on the device this app is actually used on: at 375px the columns
              ran past the edge and the day's total - the whole point of
              grouping - sat in a strip you could only reach by scrolling
              sideways. Fixed widths from `sm` up line the fields into columns
              again, so nothing is lost on a desktop. */}
          {groups.map((g) => (
            <section key={g.day}>
              <h3 className="sticky top-[var(--tx-bar-h,0px)] z-10 -mx-4 flex items-baseline justify-between gap-3 border-y border-[var(--color-line)] bg-[var(--color-raised)] px-4 py-1.5 sm:-mx-5 sm:px-5">
                <span className="text-xs font-semibold">
                  {formatDayShort(g.day)}
                  <span className="ml-2 font-normal text-[var(--color-ink-3)]">
                    {g.rows.length} {g.rows.length === 1 ? 'entry' : 'entries'}
                  </span>
                </span>
                {g.spent > 0 ? (
                  <span className="text-xs text-[var(--color-ink-3)]">
                    <span className="sensitive num font-semibold text-[var(--color-ink-2)]">
                      {money(g.spent)}
                    </span>{' '}
                    spent
                  </span>
                ) : (
                  // Nothing consumed: every row that day was a transfer.
                  <span className="text-xs text-[var(--color-ink-3)]">no spending</span>
                )}
              </h3>

              <ul>
                {g.rows.map((t) => (
                  <li
                    key={t.id}
                    className={cx(
                      'flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-[var(--color-line)] px-3 py-2.5 last:border-b-0',
                      t.deleted && 'opacity-50',
                    )}
                  >
                    <span className="num hidden w-11 shrink-0 text-xs text-[var(--color-ink-3)] sm:block">
                      {t.ts.slice(11, 16)}
                    </span>

                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <span className="truncate">{t.remarks || t.category}</span>
                      {t.deleted ? <Badge tone="bad">deleted</Badge> : null}
                      {t.isFuture ? <Badge tone="neutral">upcoming</Badge> : null}
                      {t.kind === 'card_payment' ? <Badge tone="good">bill paid</Badge> : null}
                      {t.kind === 'credit_given' ? <Badge tone="accent">lent</Badge> : null}
                      {t.verified ? (
                        <span className="text-[var(--color-pos)]" title="Matched against the statement">
                          &#10003;
                        </span>
                      ) : null}
                    </span>

                    <span className="hidden w-28 shrink-0 truncate text-xs text-[var(--color-ink-3)] sm:block">
                      {t.category}
                    </span>
                    <span className="hidden w-20 shrink-0 truncate text-xs text-[var(--color-ink-3)] sm:block">
                      {t.method || '\u2014'}
                    </span>

                    <span className="w-24 shrink-0 text-right">
                      <Money
                        value={t.amount}
                        size="sm"
                        tone={t.kind === 'card_payment' ? 'credit' : 'neutral'}
                      />
                    </span>

                    <span className="flex w-[68px] shrink-0 justify-end gap-0.5">
                      {t.deleted ? (
                        <Button
                          variant="ghost" size="icon" disabled={pending}
                          onClick={() => restore(t)} aria-label={`Restore entry of ${money(t.amount)}`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost" size="icon" disabled={pending}
                            onClick={() => openEdit(t)} aria-label={`Edit entry of ${money(t.amount)}`}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" disabled={pending}
                            onClick={() => setConfirming(t)} aria-label={`Delete entry of ${money(t.amount)}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </span>

                    {/* The phone's version of the Category and Method columns. */}
                    <span className="w-full text-[11px] text-[var(--color-ink-3)] sm:hidden">
                      <span className="num">{t.ts.slice(11, 16)}</span>
                      {' · '}{t.category}
                      {t.method ? ` · ${t.method}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <TransactionDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        defaultTs={defaultTs}
        onSaved={() => router.refresh()}
      />

      {/* Deleting changes a balance, so it is confirmed against the actual
          figures rather than a generic "are you sure?". */}
      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Delete this entry?"
        description="It is kept in history and can be restored, but it will stop counting towards your balances immediately."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" pending={pending} onClick={() => confirming && remove(confirming)}>
              Delete
            </Button>
          </>
        }
      >
        {confirming ? (
          <dl className="flex flex-col gap-1.5 rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-ink-3)]">Amount</dt>
              <dd><Money value={confirming.amount} size="sm" className="font-semibold" /></dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-ink-3)]">Date</dt>
              <dd className="num text-xs">{formatDayShort(confirming.ts.slice(0, 10))}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-ink-3)]">Details</dt>
              <dd className="truncate text-xs">
                {confirming.remarks || confirming.category} · {confirming.method || 'no method'}
              </dd>
            </div>
          </dl>
        ) : null}
      </Dialog>

      {/* Clear of the tab bar — 52px of row plus its own padding, plus the
          home indicator underneath it — so it never sits on a destination.
          `main` already reserves pb-24, so it covers no row either. */}
      <button
        type="button"
        onClick={openAdd}
        aria-label="New entry"
        className="fixed right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-ink)] shadow-[var(--shadow-pop)] transition-transform active:scale-95 lg:hidden"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4.75rem)' }}
      >
        <Plus className="h-6 w-6" strokeWidth={2.25} aria-hidden="true" />
      </button>

      <span className="sr-only" aria-hidden="true" data-now={nowIso} />
    </div>
  );
}
