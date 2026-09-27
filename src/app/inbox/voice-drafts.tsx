'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Money, Panel, SectionTitle } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { TransactionDialog } from '@/app/transactions/transaction-dialog';
import type { VoiceDraft } from '@/lib/voice-drafts';
import { forgetVoiceDraftAction } from './actions';

/* ===========================================================================
   Voice notes from the iPhone, waiting to be checked and added.

   Each shows WHAT WAS HEARD beside what was read from it, because the one
   error speech makes most — "fifty for" heard as fifty-four — is invisible in
   the amount alone and obvious next to the words. "Entry" opens the ordinary
   form with every field filled and the words above it; nothing is saved until
   Add entry.
   =========================================================================== */

export function VoiceDrafts({ drafts }: { drafts: VoiceDraft[] }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<VoiceDraft | null>(null);

  if (drafts.length === 0) return null;

  const forget = (id: string, done?: string) =>
    startTransition(async () => {
      const r = await forgetVoiceDraftAction({ id });
      if (!r.ok) { notify('error', r.error); return; }
      if (done) notify('success', done);
      router.refresh();
    });

  const note = (d: VoiceDraft) => {
    const unsure = d.uncertain.length ? ` Not sure of: ${d.uncertain.join(', ')}.` : '';
    return `${d.via === 'audio' ? 'Heard' : 'Dictated'}: "${d.heard}". Check the amount against it before adding.${unsure}`;
  };

  return (
    <Panel className="mb-4">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
          Voice notes · {drafts.length}
        </span>
      </SectionTitle>

      <ul className="flex flex-col gap-2">
        {drafts.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-field)] border border-[var(--color-line)] px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                {d.amount ? <Money value={Number(d.amount)} /> : <span className="text-[var(--color-warn)]">amount?</span>}
                <span className="text-[var(--color-ink-2)]">
                  {d.category ?? <span className="text-[var(--color-warn)]">category?</span>}
                  {' · '}
                  {d.method ?? <span className="text-[var(--color-warn)]">paid from?</span>}
                </span>
                {d.remarks ? <span className="truncate text-[var(--color-ink)]">{d.remarks}</span> : null}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--color-ink-3)]">
                {d.via === 'audio' ? 'Heard' : 'Dictated'} &ldquo;{d.heard}&rdquo; · {d.ts.slice(11, 16)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button size="sm" onClick={() => setOpen(d)} disabled={pending}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Entry
              </Button>
              <Button
                variant="ghost" size="icon" disabled={pending}
                onClick={() => forget(d.id, 'Voice note discarded.')}
                aria-label="Discard this voice note"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <TransactionDialog
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        editing={null}
        // Dated when it was spoken, not when it was checked.
        defaultTs={open?.ts ?? ''}
        draft={open ? {
          ...(open.amount ? { amount: Number(open.amount) } : {}),
          ...(open.method ? { method: open.method } : {}),
          ...(open.category ? { category: open.category } : {}),
          remarks: open.remarks,
        } : null}
        note={open ? note(open) : null}
        onSaved={(id) => {
          const d = open;
          setOpen(null);
          // Only once the entry actually exists does the note go.
          if (d && id) forget(d.id);
        }}
      />
    </Panel>
  );
}
