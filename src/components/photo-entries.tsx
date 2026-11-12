'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Camera, ChevronDown, ChevronUp, CircleHelp, History, MapPin, X } from 'lucide-react';
import { EditEntryButton } from '@/components/entry/entry-editor';
import { captureSrc, SafeImage } from '@/components/capture-image';
import { PlaceText } from '@/components/place-name';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { ackAutoAddedAction, addCategoryRuleAction, fillEntryAction } from '@/app/transactions/draft-actions';
import { formatDayShort } from '@/lib/time';
import { mapsUrl } from '@/lib/place';
import { ALL_METHODS } from '@/lib/types';
import { PICKABLE_CATEGORIES } from '@/lib/payee-hint';
import type { Hint } from '@/lib/payee-hint';
import type { PhotoEntryRow } from '@/lib/draft-auto';

/* Entries the app made from photos without being asked.

   Two lists, the way corrections and questions are two lists:

     - NEEDS A DETAIL: the photo did not say what paid, or what it was for.
       The entry is already in the ledger with what was read; the gap is
       asked for here, one pick each, and the row leaves when it is filled.
       It stays until then — acknowledging the notice does not hide it.
       Each row shows the photo it was read off and where it was spent, so
       the gap can be answered without leaving the list.
     - ADDED: everything else made since the list was last acknowledged,
       shown so that automatic is never quiet. */

const when = (ts: string) => {
  const h = Number(ts.slice(11, 13));
  const time = `${h % 12 === 0 ? 12 : h % 12}:${ts.slice(14, 16)} ${h < 12 ? 'AM' : 'PM'}`;
  return `${formatDayShort(ts.slice(0, 10))}, ${time}`;
};

const SHOWN = 5;

/* The photo an entry was read off, and where it was spent: what a person
   needs to say what it was for. The thumbnail opens full size — the name on
   a payment screen is unreadable at 48px. */
function Thumb({ r, onOpen }: { r: PhotoEntryRow; onOpen: (id: string) => void }) {
  if (!r.photo) return null;
  const photo = r.photo;
  return (
    <button
      type="button"
      onClick={() => onOpen(photo)}
      aria-label={`See the photo for ${r.remarks || 'this entry'}`}
      className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-[var(--color-line)]"
    >
      <SafeImage src={captureSrc(photo)} alt="" loading="lazy" className="h-full w-full object-cover" />
    </button>
  );
}

function Where({ r }: { r: PhotoEntryRow }) {
  if (!r.place) return null;
  return (
    <a
      href={mapsUrl(r.place)}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-0.5 flex w-fit max-w-full items-center gap-1 text-[11px] text-[var(--color-ink-3)] hover:text-[var(--color-accent)]"
    >
      <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="sensitive truncate">Spent at <PlaceText place={r.place} area /></span>
    </a>
  );
}

/* "Family · as before": what earlier entries to the same name were filed
   under, one tap to take it. Offered, never filled — see lib/payee-hint. */
function HintButton({ r, hint, field, disabled, onPick }: {
  r: PhotoEntryRow; hint: Hint; field: 'method' | 'category'; disabled: boolean;
  onPick: (r: PhotoEntryRow, field: 'method' | 'category', value: string) => void;
}) {
  const times = hint.of === 1 ? 'once before' : `${hint.count} of ${hint.of} times before`;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(r, field, hint.value)}
      title={`${r.remarks} was ${field === 'category' ? 'filed under' : 'paid from'} ${hint.value} ${times}`}
      aria-label={`Use ${hint.value}, as before for ${r.remarks}`}
      className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-field)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-2 text-xs font-medium text-[var(--color-ink)] disabled:opacity-50"
    >
      <History className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden="true" />
      {hint.value}
      <span className="font-normal text-[var(--color-ink-3)]">· as before</span>
    </button>
  );
}

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
  const [zoomed, setZoomed] = useState<string | null>(null);
  // Rows where the category picked should become a rule for the name.
  const [always, setAlways] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!zoomed) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomed(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [zoomed]);

  if (needs.length === 0 && unseen === 0) return null;

  const fill = (r: PhotoEntryRow, field: 'method' | 'category', value: string) => {
    if (!value) return;
    startTransition(async () => {
      if (field === 'category' && always[r.id] && r.remarks.trim()) {
        // A rule for the name, which fills this entry and every other one waiting.
        const res = await addCategoryRuleAction({ words: r.remarks, category: value });
        if (!res.ok) { notify('error', res.error); return; }
        const others = res.data.filled - 1;
        notify('success', `Every “${r.remarks}” is now ${value}${others > 0 ? ` · ${others} more filled` : ''}.`);
      } else {
        const res = await fillEntryAction({ id: r.id, [field]: value });
        if (!res.ok) { notify('error', res.error); return; }
        notify('success', `${r.remarks || 'Entry'}: ${value}.`);
      }
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
            Tick <span className="font-medium text-[var(--color-ink-2)]">Always</span> before choosing and every
            payment to that name gets the same category ·{' '}
            <Link href="/settings#category-rules" className="text-[var(--color-accent)]">Your rules</Link>
          </p>
          <ul className="flex flex-col gap-2">
            {shownNeeds.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-field)] bg-[var(--color-surface)] px-3 py-2 text-xs"
              >
                <span className="flex min-w-0 flex-1 basis-48 items-start gap-2.5">
                  <Thumb r={r} onOpen={setZoomed} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-[var(--color-ink)]">{r.remarks || 'Unnamed'}</span>
                    <span className="text-[var(--color-ink-3)]"> · </span>
                    <Money value={r.amount} size="sm" />
                    <span className="mt-0.5 block text-[11px] text-[var(--color-ink-3)]">
                      {when(r.ts)}{r.method ? ` · ${r.method}` : ''}{r.category ? ` · ${r.category}` : ''}
                    </span>
                    <Where r={r} />
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {!r.method && r.hint?.method ? (
                    <HintButton r={r} hint={r.hint.method} field="method" disabled={pending} onPick={fill} />
                  ) : null}
                  {!r.category && r.hint?.category ? (
                    <HintButton r={r} hint={r.hint.category} field="category" disabled={pending} onPick={fill} />
                  ) : null}
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
                      {PICKABLE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : null}
                  {!r.category && r.remarks.trim() ? (
                    <label
                      title={`Use the category you choose for every payment to “${r.remarks}”, now and from now on`}
                      className="inline-flex h-8 cursor-pointer items-center gap-1 px-1 text-[11px] text-[var(--color-ink-2)]"
                    >
                      <input
                        type="checkbox"
                        checked={always[r.id] ?? false}
                        disabled={pending}
                        onChange={(e) => setAlways((a) => ({ ...a, [r.id]: e.target.checked }))}
                        aria-label={`Always use this category for ${r.remarks}`}
                        className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                      />
                      Always
                    </label>
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
                  <Thumb r={r} onOpen={setZoomed} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-[var(--color-ink)]">{r.remarks || r.category}</span>
                    <span className="text-[var(--color-ink-3)]"> · </span>
                    <Money value={r.amount} size="sm" />
                    <span className="mt-0.5 block text-[11px] text-[var(--color-ink-3)]">
                      {when(r.ts)} · {r.method} · {r.category}
                      {r.rule ? <> · <span className="text-[var(--color-accent)]">by your rule “{r.rule}”</span></> : null}
                    </span>
                    <Where r={r} />
                  </span>
                  <EditEntryButton id={r.id} label={`Edit ${r.remarks || 'this entry'}`} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* Full size, the same viewer Entries uses for an attached photo. */}
      {zoomed ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          onClick={() => setZoomed(null)}
        >
          <SafeImage src={captureSrc(zoomed)} className="max-h-full max-w-full rounded-[var(--radius-card)] object-contain" />
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
    </>
  );
}
