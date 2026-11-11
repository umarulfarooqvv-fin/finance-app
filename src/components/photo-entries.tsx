'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, ChevronDown, ChevronUp, CircleHelp } from 'lucide-react';
import { EditEntryButton } from '@/components/entry/entry-editor';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { ackAutoAddedAction, fillEntryAction } from '@/app/transactions/draft-actions';
import { formatDayShort } from '@/lib/time';
import { ALL_METHODS, SPEND_CATEGORIES } from '@/lib/types';
import type { PhotoEntryRow } from '@/lib/draft-auto';

/* Entries the app made from photos without being asked.

   Two lists, the way corrections and questions are two lists:

     - NEEDS A DETAIL: the photo did not say what paid, or what it was for.
       The entry is already in the ledger with what was read; the gap is
       asked for here, one pick each, and the row leaves when it is filled.
       It stays until then — acknowledging the notice does not hide it.
     - ADDED: everything else made since the list was last acknowledged,
       shown so that automatic is never quiet. */

const when = (ts: string) => {
  const h = Number(ts.slice(11, 13));
  const time = `${h % 12 === 0 ? 12 : h % 12}:${ts.slice(14, 16)} ${h < 12 ? 'AM' : 'PM'}`;
  return `${formatDayShort(ts.slice(0, 10))}, ${time}`;
};

const CATEGORIES = [...SPEND_CATEGORIES.filter((c) => c !== 'Credit Return'), 'Credit Given'];
const SHOWN = 5;

const pick =
  'h-8 max-w-full rounded-[var(--radius-field)] border border-[var(--color-warn)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-ink)] disabled:opacity-50';

export function PhotoEntries({
  needs, added, unseen,
}: {
  needs: PhotoEntryRow[];
  added: PhotoEntryRow[];
  /** How many were added since the notice was last acknowledged. */
  unseen: number;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [allNeeds, setAllNeeds] = useState(false);
  const [showAdded, setShowAdded] = useState(false);

  if (needs.length === 0 && unseen === 0) return null;

  const fill = (r: PhotoEntryRow, field: 'method' | 'category', value: string) => {
    if (!value) return;
    startTransition(async () => {
      const res = await fillEntryAction({ id: r.id, [field]: value });
      if (!res.ok) { notify('error', res.error); return; }
      notify('success', `${r.remarks || 'Entry'}: ${value}.`);
      router.refresh();
    });
  };

  const ack = () =>
    startTransition(async () => {
      const res = await ackAutoAddedAction({});
      if (!res.ok) { notify('error', res.error); return; }
      router.refresh();
    });

  const shownNeeds = allNeeds ? needs : needs.slice(0, SHOWN);

  return (
    <>
      {needs.length > 0 ? (
        <section
          aria-label="Entries from photos that need a detail"
          className="mb-4 rounded-[var(--radius-card)] border border-[var(--color-warn)] p-3 sm:p-4"
        >
          <h2 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-warn)]">
            <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
            {needs.length === 1 ? 'An entry from a photo needs a detail' : `${needs.length} entries from photos need a detail`}
          </h2>
          <p className="mb-2 mt-0.5 text-[11px] text-[var(--color-ink-3)]">
            Already added with what the photo showed. Without a category an entry is in no spending total yet.
          </p>
          <ul className="flex flex-col gap-2">
            {shownNeeds.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-field)] bg-[var(--color-surface)] px-3 py-2 text-xs"
              >
                <span className="min-w-0 flex-1 basis-40">
                  <span className="font-medium text-[var(--color-ink)]">{r.remarks || 'Unnamed'}</span>
                  <span className="text-[var(--color-ink-3)]"> · </span>
                  <Money value={r.amount} size="sm" />
                  <span className="mt-0.5 block text-[11px] text-[var(--color-ink-3)]">
                    {when(r.ts)}{r.method ? ` · ${r.method}` : ''}{r.category ? ` · ${r.category}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {!r.method ? (
                    <select
                      aria-label={`Paid from, for ${r.remarks || 'this entry'}`}
                      className={pick} disabled={pending} value=""
                      onChange={(e) => fill(r, 'method', e.target.value)}
                    >
                      <option value="">Paid from…</option>
                      {ALL_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : null}
                  {!r.category ? (
                    <select
                      aria-label={`Category for ${r.remarks || 'this entry'}`}
                      className={pick} disabled={pending} value=""
                      onChange={(e) => fill(r, 'category', e.target.value)}
                    >
                      <option value="">Category…</option>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : null}
                  <EditEntryButton id={r.id} label={`Edit ${r.remarks || 'this entry'}`} />
                </span>
              </li>
            ))}
          </ul>
          {needs.length > SHOWN ? (
            <button type="button" onClick={() => setAllNeeds((a) => !a)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)]">
              {allNeeds ? <>Show fewer <ChevronUp className="h-3.5 w-3.5" /></> : <>Show all {needs.length} <ChevronDown className="h-3.5 w-3.5" /></>}
            </button>
          ) : null}
        </section>
      ) : null}

      {unseen > 0 ? (
        <section
          aria-label="Entries added from photos"
          className="mb-4 rounded-[var(--radius-card)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-3 sm:p-4"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
              <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {unseen === 1 ? 'An entry was added from your photo' : `${unseen} entries were added from your photos`}
            </h2>
            {added.length > 0 ? (
              <button type="button" onClick={() => setShowAdded((s) => !s)}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)]">
                {showAdded ? <>Hide <ChevronUp className="h-3.5 w-3.5" /></> : <>See them <ChevronDown className="h-3.5 w-3.5" /></>}
              </button>
            ) : null}
            <Button size="sm" disabled={pending} onClick={ack}>OK</Button>
          </div>
          {showAdded ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {added.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 rounded-[var(--radius-field)] bg-[var(--color-surface)] px-3 py-2 text-xs"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-[var(--color-ink)]">{r.remarks || r.category}</span>
                    <span className="text-[var(--color-ink-3)]"> · </span>
                    <Money value={r.amount} size="sm" />
                    <span className="mt-0.5 block text-[11px] text-[var(--color-ink-3)]">
                      {when(r.ts)} · {r.method} · {r.category}
                    </span>
                  </span>
                  <EditEntryButton id={r.id} label={`Edit ${r.remarks || 'this entry'}`} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
