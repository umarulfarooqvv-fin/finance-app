'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { formatDayShort } from '@/lib/time';
import type { PhotoCorrection } from '@/lib/photo-check';
import {
  dismissPhotoCorrectionAction, undoPhotoCorrectionAction,
} from '@/app/transactions/photo-actions';

/* Every entry the app moved to a different card because its photo said so —
   shown until acknowledged, each with an undo. The correction is automatic;
   it is never allowed to be quiet. */
export function PhotoCorrections({ corrections }: { corrections: PhotoCorrection[] }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();

  if (corrections.length === 0) return null;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) { notify('error', r.error ?? 'That did not work.'); return; }
      notify('success', done);
      router.refresh();
    });

  return (
    <section
      aria-label="Entries corrected from their photos"
      className="mb-4 rounded-[var(--radius-card)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-3 sm:p-4"
    >
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
        <Camera className="h-3.5 w-3.5" aria-hidden="true" />
        {corrections.length === 1 ? 'An entry was moved to the card its photo shows' : `${corrections.length} entries were moved to the card their photos show`}
      </h2>
      <ul className="flex flex-col gap-2">
        {corrections.map((c) => (
          <li
            key={c.transactionId}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-field)] bg-[var(--color-surface)] px-3 py-2 text-xs"
          >
            <span className="min-w-0 flex-1">
              <span className="font-medium text-[var(--color-ink)]">{c.remarks || 'Entry'}</span>
              <span className="text-[var(--color-ink-3)]"> · {formatDayShort(c.ts.slice(0, 10))} · </span>
              <Money value={c.amount} size="sm" />
              <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[var(--color-ink-2)]">
                {c.from || 'no card'} <ArrowRight className="h-3 w-3" aria-hidden="true" />
                <span className="font-medium text-[var(--color-ink)]">{c.to}</span>
                <span className="text-[var(--color-ink-3)]">— the photo shows &ldquo;{c.label}&rdquo;</span>
              </span>
            </span>
            <span className="flex shrink-0 gap-1.5">
              <Button
                size="sm" variant="secondary" disabled={pending}
                onClick={() => act(() => undoPhotoCorrectionAction({ transactionId: c.transactionId }), `Moved back to ${c.from}.`)}
              >
                Undo
              </Button>
              <Button
                size="sm" disabled={pending}
                onClick={() => act(() => dismissPhotoCorrectionAction({ transactionId: c.transactionId }), 'Kept.')}
              >
                OK
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
