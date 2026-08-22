'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { formatDayShort } from '@/lib/time';
import { money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { Badge, Empty, Money, TableWrap, Td, Th } from '@/components/ui/primitives';
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

export function TransactionsClient({
  rows, defaultTs, nowIso,
}: {
  rows: Row[];
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

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New entry
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty title="Nothing matches" hint="Try a different search, or add an entry." />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Description</Th>
              <Th>Category</Th>
              <Th>Method</Th>
              <Th align="right">Amount</Th>
              <Th align="right">{''}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={t.deleted ? 'opacity-50' : undefined}>
                <Td className="whitespace-nowrap text-xs text-[var(--color-ink-2)]">
                  {formatDayShort(t.ts.slice(0, 10))}
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="truncate">{t.remarks || t.category}</span>
                    {t.deleted ? <Badge tone="bad">deleted</Badge> : null}
                    {t.isFuture ? <Badge tone="neutral">upcoming</Badge> : null}
                    {t.kind === 'card_payment' ? <Badge tone="good">bill paid</Badge> : null}
                    {t.kind === 'credit_given' ? <Badge tone="accent">lent</Badge> : null}
                    {t.verified ? (
                      <span className="text-[var(--color-pos)]" title="Matched against the statement">✓</span>
                    ) : null}
                  </span>
                </Td>
                <Td className="text-xs text-[var(--color-ink-3)]">{t.category}</Td>
                <Td className="text-xs text-[var(--color-ink-3)]">{t.method || '—'}</Td>
                <Td align="right">
                  <Money value={t.amount} size="sm" tone={t.kind === 'card_payment' ? 'credit' : 'neutral'} />
                </Td>
                <Td align="right">
                  <span className="flex justify-end gap-0.5">
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
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
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

      <span className="sr-only" aria-hidden="true" data-now={nowIso} />
    </>
  );
}
