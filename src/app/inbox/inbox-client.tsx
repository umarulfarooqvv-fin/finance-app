'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, X } from 'lucide-react';
import { formatDayShort } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { Empty } from '@/components/ui/primitives';
import { SafeImage } from '@/components/capture-image';
import { TransactionDialog } from '@/app/transactions/transaction-dialog';
import { discardCaptureAction, linkCaptureAction } from './actions';

/* ===========================================================================
   Photos waiting to become entries.

   The photo is the prompt, not the data. Turning one into a transaction opens
   the ORDINARY entry form with the capture's own timestamp filled in, so the
   row lands dated when the money was actually spent rather than when there was
   finally a minute to type it — which is the whole reason the photo was taken.

   Nothing here reads the image. No amount is inferred from a picture of a
   bill; a person looks at it and types what it says.
   =========================================================================== */

export type Capture = { id: string; ts: string; note: string; bytes: number };

export function InboxClient({ captures, defaultTs }: { captures: Capture[]; defaultTs: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();

  const [entryFor, setEntryFor] = useState<Capture | null>(null);
  const [confirming, setConfirming] = useState<Capture | null>(null);
  const [zoomed, setZoomed] = useState<Capture | null>(null);

  function discard(c: Capture) {
    startTransition(async () => {
      const result = await discardCaptureAction({ id: c.id });
      if (!result.ok) { notify('error', result.error); return; }
      setConfirming(null);
      notify('success', 'Photo discarded.');
      router.refresh();
    });
  }

  /* The capture is only marked used once the entry actually saved. If the form
     is cancelled, or the save fails, the photo stays in the inbox — losing the
     prompt while creating nothing is the one outcome worth designing out. */
  function onSaved(capture: Capture, transactionId: string | null) {
    startTransition(async () => {
      if (transactionId) {
        const linked = await linkCaptureAction({ id: capture.id, transactionId });
        if (!linked.ok) notify('error', `Entry saved, but the photo stayed here: ${linked.error}`);
      }
      router.refresh();
    });
  }

  if (captures.length === 0) {
    return (
      <Empty
        title="Nothing waiting"
        hint="Photos sent from the Shortcut appear here until you turn them into entries."
      />
    );
  }

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {captures.map((c) => (
          <li
            key={c.id}
            className="flex flex-col overflow-hidden rounded-[var(--radius-field)] border border-[var(--color-line)]"
          >
            <button
              type="button"
              onClick={() => setZoomed(c)}
              className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--color-raised)]"
              aria-label={`View the photo from ${formatDayShort(c.ts.slice(0, 10))}`}
            >
              {/* A plain <img>, not next/image: the bytes come from a
                  session-guarded route rather than an origin the optimiser can
                  be configured for, and optimising would mean a second service
                  fetching a picture of somebody's bill. */}
              <SafeImage
                src={`/api/capture/${c.id}`}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>

            <div className="flex flex-1 flex-col gap-2 p-2.5">
              <div className="min-w-0">
                <div className="num text-xs font-medium">{formatDayShort(c.ts.slice(0, 10))}</div>
                <div className="num text-[11px] text-[var(--color-ink-3)]">
                  {c.ts.slice(11, 16)} · {Math.max(1, Math.round(c.bytes / 1024))} KB
                </div>
                {c.note ? (
                  <p className="mt-1 line-clamp-2 text-[11px] text-[var(--color-ink-2)]">{c.note}</p>
                ) : null}
              </div>

              <div className="mt-auto flex items-center gap-1.5">
                <Button size="sm" className="flex-1" onClick={() => setEntryFor(c)} disabled={pending}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Entry
                </Button>
                <Button
                  variant="ghost" size="icon" disabled={pending}
                  onClick={() => setConfirming(c)}
                  aria-label="Discard this photo"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Full size, because the amount on a receipt is unreadable in a tile. */}
      {zoomed ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          onClick={() => setZoomed(null)}
        >
          {/* Plain <img>, for the reason given above. */}
          <SafeImage
            src={`/api/capture/${zoomed.id}`}
            className="max-h-full max-w-full rounded-[var(--radius-card)] object-contain"
          />
          <button
            type="button"
            onClick={() => setZoomed(null)}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <TransactionDialog
        open={entryFor !== null}
        onOpenChange={(o) => !o && setEntryFor(null)}
        editing={null}
        // The photo's own timestamp, so the entry is dated when it happened.
        defaultTs={entryFor?.ts ?? defaultTs}
        onSaved={(id) => {
          const c = entryFor;
          setEntryFor(null);
          if (c) onSaved(c, id ?? null);
        }}
      />

      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Discard this photo?"
        description="The image is deleted. Nothing else is affected — no entry was created from it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" pending={pending} onClick={() => confirming && discard(confirming)}>
              Discard
            </Button>
          </>
        }
      >
        {confirming ? (
          <p className="text-sm text-[var(--color-ink-2)]">
            Taken {formatDayShort(confirming.ts.slice(0, 10))} at {confirming.ts.slice(11, 16)}.
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
