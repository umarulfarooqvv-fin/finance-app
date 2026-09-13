'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { formatDayShort } from '@/lib/time';
import { money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { Badge, cx, Empty, Money } from '@/components/ui/primitives';
import { IncomeDialog, type Debtor, type EditableIncome } from './income-dialog';
import { deleteIncomeAction, restoreIncomeAction } from './actions';

/* ===========================================================================
   The income list.

   Grouped by month rather than by day: income arrives a handful of times a
   month, so a day heading per row would be all heading and no list.
   =========================================================================== */

export type Row = EditableIncome & { needsReview: boolean; deleted: boolean };
export type MonthGroup = { month: string; label: string; total: number; rows: Row[] };

export function IncomeClient({
  groups, defaultTs, debtors,
}: {
  groups: MonthGroup[];
  defaultTs: string;
  /** People who still owe money, offered when recording a return. */
  debtors: Debtor[];
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EditableIncome | null>(null);
  const [confirming, setConfirming] = useState<Row | null>(null);

  function remove(row: Row) {
    startTransition(async () => {
      const result = await deleteIncomeAction({ id: row.id });
      if (!result.ok) { notify('error', result.error); return; }
      setConfirming(null);
      notify('success', 'Income deleted. It is kept in history and can be restored.');
      router.refresh();
    });
  }

  function restore(row: Row) {
    startTransition(async () => {
      const result = await restoreIncomeAction({ id: row.id });
      if (!result.ok) { notify('error', result.error); return; }
      notify('success', 'Income restored.');
      router.refresh();
    });
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Record income
        </Button>
      </div>

      {groups.length === 0 ? (
        <Empty title="No income recorded" hint="Record one here, or post it from the Shortcut." />
      ) : (
        <div className="flex flex-col">
          {groups.map((g) => (
            <section key={g.month}>
              <h3 className="sticky top-0 z-10 -mx-4 flex items-baseline justify-between gap-3 border-y border-[var(--color-line)] bg-[var(--color-raised)] px-4 py-1.5 sm:-mx-5 sm:px-5">
                <span className="text-xs font-semibold">
                  {g.label}
                  <span className="ml-2 font-normal text-[var(--color-ink-3)]">
                    {g.rows.length} {g.rows.length === 1 ? 'entry' : 'entries'}
                  </span>
                </span>
                <Money value={g.total} size="sm" tone="credit" className="font-semibold" />
              </h3>

              <ul>
                {g.rows.map((r) => (
                  <li
                    key={r.id}
                    className={cx(
                      'flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-[var(--color-line)] px-3 py-2.5 last:border-b-0',
                      r.deleted && 'opacity-50',
                    )}
                  >
                    <span className="num hidden w-24 shrink-0 text-xs text-[var(--color-ink-3)] sm:block">
                      {formatDayShort(r.ts.slice(0, 10))}
                    </span>

                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <span className="truncate">{r.remarks || r.source}</span>
                      {r.deleted ? <Badge tone="bad">deleted</Badge> : null}
                      {r.needsReview ? <Badge tone="warn">check</Badge> : null}
                    </span>

                    <span className="hidden w-32 shrink-0 truncate text-xs text-[var(--color-ink-3)] sm:block">
                      {r.source}
                    </span>
                    <span className="hidden w-20 shrink-0 truncate text-xs text-[var(--color-ink-3)] sm:block">
                      {r.account || '—'}
                    </span>

                    <span className="w-28 shrink-0 text-right">
                      <Money value={r.amount} size="sm" tone="credit" />
                    </span>

                    <span className="flex w-[68px] shrink-0 justify-end gap-0.5">
                      {r.deleted ? (
                        <Button
                          variant="ghost" size="icon" disabled={pending}
                          onClick={() => restore(r)} aria-label={`Restore income of ${money(r.amount)}`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost" size="icon" disabled={pending}
                            onClick={() => { setEditing(r); setFormOpen(true); }}
                            aria-label={`Edit income of ${money(r.amount)}`}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" disabled={pending}
                            onClick={() => setConfirming(r)}
                            aria-label={`Delete income of ${money(r.amount)}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </span>

                    <span className="w-full text-[11px] text-[var(--color-ink-3)] sm:hidden">
                      <span className="num">{formatDayShort(r.ts.slice(0, 10))}</span>
                      {' · '}{r.source}
                      {r.account ? ` · ${r.account}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <IncomeDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        defaultTs={defaultTs}
        debtors={debtors}
        onSaved={() => router.refresh()}
      />

      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Delete this income entry?"
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
              <dd><Money value={confirming.amount} size="sm" tone="credit" className="font-semibold" /></dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-ink-3)]">Date</dt>
              <dd className="num text-xs">{formatDayShort(confirming.ts.slice(0, 10))}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--color-ink-3)]">Details</dt>
              <dd className="truncate text-xs">
                {confirming.source} · {confirming.account || 'no account'}
              </dd>
            </div>
          </dl>
        ) : null}
      </Dialog>
    </>
  );
}
