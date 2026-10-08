'use client';

import { EditEntryButton } from '@/components/entry/entry-editor';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { formatDayShort } from '@/lib/time';
import type { PhotoCorrection, PhotoQuestion } from '@/lib/photo-check';
import {
  answerPhotoQuestionAction, dismissPhotoCorrectionAction, undoPhotoCorrectionAction,
} from '@/app/transactions/photo-actions';

/* What entries' photos changed, and what they raised.

   Corrections — the card or the time moved — are shown until acknowledged,
   each with an undo: automatic, never quiet. Questions come first and look
   different, because nothing has happened yet and something needs deciding:
   the photo points at a moment when another entry already looks like the
   same payment. */

const when = (ts: string) => {
  const h = Number(ts.slice(11, 13));
  const time = `${h % 12 === 0 ? 12 : h % 12}:${ts.slice(14, 16)} ${h < 12 ? 'AM' : 'PM'}`;
  return `${formatDayShort(ts.slice(0, 10))}, ${time}`;
};

/** "Not a duplicate — move to 26 Sep, 5:44 PM on Scapia". */
function applyLabel(p: PhotoQuestion['proposal']): string {
  const parts: string[] = [];
  if (p.ts) parts.push(`move to ${when(p.ts.to)}`);
  if (p.method) parts.push(`${p.ts ? 'on' : 'move to'} ${p.method.to}`);
  return `Not a duplicate — ${parts.join(' ')}`;
}

function Change({ from, to, note }: { from: string; to: string; note?: string }) {
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[var(--color-ink-2)]">
      {from || '—'} <ArrowRight className="h-3 w-3" aria-hidden="true" />
      <span className="font-medium text-[var(--color-ink)]">{to}</span>
      {note ? <span className="text-[var(--color-ink-3)]">— {note}</span> : null}
    </span>
  );
}

export function PhotoCorrections({
  corrections, questions = [],
}: {
  corrections: PhotoCorrection[];
  questions?: PhotoQuestion[];
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();

  if (corrections.length === 0 && questions.length === 0) return null;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) { notify('error', r.error ?? 'That did not work.'); return; }
      notify('success', done);
      router.refresh();
    });

  return (
    <>
      {questions.length > 0 ? (
        <section
          aria-label="Possible duplicates found from photos"
          className="mb-4 rounded-[var(--radius-card)] border border-[var(--color-warn)] p-3 sm:p-4"
        >
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-warn)]">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {questions.length === 1 ? 'Is this the same payment twice?' : `${questions.length} possible duplicates`}
          </h2>
          <ul className="flex flex-col gap-2">
            {questions.map((q) => {
              const moveTo = q.proposal.ts?.to;
              return (
                <li key={q.transactionId} className="rounded-[var(--radius-field)] bg-[var(--color-surface)] px-3 py-2 text-xs">
                  <p className="text-[var(--color-ink-2)]">
                    The photo on <span className="font-medium text-[var(--color-ink)]">{q.remarks || 'this entry'}</span>{' '}
                    (<Money value={q.amount} size="sm" />, {q.method}, logged {when(q.ts)}) shows a payment at{' '}
                    <span className="font-medium text-[var(--color-ink)]">{when(moveTo ?? q.ts)}</span> — and{' '}
                    <span className="font-medium text-[var(--color-ink)]">{q.duplicate.remarks || 'another entry'}</span>{' '}
                    ({q.duplicate.method}, {when(q.duplicate.ts)}) is already there: {q.why}.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <EditEntryButton id={q.transactionId} label={`Edit ${q.remarks || 'this entry'}`} />
                    <Button
                      size="sm" disabled={pending}
                      onClick={() => act(
                        () => answerPhotoQuestionAction({ transactionId: q.transactionId, answer: 'duplicate' }),
                        'Duplicate removed; its photo moved to the entry kept.',
                      )}
                    >
                      Duplicate — delete this one
                    </Button>
                    {q.proposal.ts || q.proposal.method ? (
                      <Button
                        size="sm" variant="secondary" disabled={pending}
                        onClick={() => act(
                          () => answerPhotoQuestionAction({ transactionId: q.transactionId, answer: 'apply' }),
                          'Changed to match the photo.',
                        )}
                      >
                        {applyLabel(q.proposal)}
                      </Button>
                    ) : null}
                    <Button
                      size="sm" variant="ghost" disabled={pending}
                      onClick={() => act(
                        () => answerPhotoQuestionAction({ transactionId: q.transactionId, answer: 'leave' }),
                        'Left as it is.',
                      )}
                    >
                      {q.proposal.ts || q.proposal.method ? 'Leave as is' : 'Not a duplicate'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {corrections.length > 0 ? (
        <section
          aria-label="Entries corrected from their photos"
          className="mb-4 rounded-[var(--radius-card)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-3 sm:p-4"
        >
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
            <Camera className="h-3.5 w-3.5" aria-hidden="true" />
            {corrections.length === 1 ? 'An entry was corrected from its photo' : `${corrections.length} entries were corrected from their photos`}
          </h2>
          <ul className="flex flex-col gap-2">
            {corrections.map((c) => (
              <li
                key={c.transactionId}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-field)] bg-[var(--color-surface)] px-3 py-2 text-xs"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-[var(--color-ink)]">{c.remarks || 'Entry'}</span>
                  <span className="text-[var(--color-ink-3)]"> · </span>
                  <Money value={c.amount} size="sm" />
                  {c.method ? (
                    <Change from={c.method.from} to={c.method.to} note={`the photo shows “${c.method.label}”`} />
                  ) : null}
                  {c.time ? <Change from={when(c.time.from)} to={when(c.time.to)} note="the time on the photo" /> : null}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <EditEntryButton id={c.transactionId} label={`Edit ${c.remarks || 'this entry'}`} />
                  <Button
                    size="sm" variant="secondary" disabled={pending}
                    onClick={() => act(() => undoPhotoCorrectionAction({ transactionId: c.transactionId }), 'Put back as it was logged.')}
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
      ) : null}
    </>
  );
}
