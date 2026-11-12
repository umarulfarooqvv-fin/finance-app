'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Equal, Loader2, MapPin, Pencil, Sparkles, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { Money, cx } from '@/components/ui/primitives';
import { TagChips } from '@/components/entry/tag-input';
import { captureSrc, SafeImage } from '@/components/capture-image';
import { TransactionDialog } from './transaction-dialog';
import {
  addDraftEntryAction, autoAddDraftsAction, draftSavedAction, hideDraftAction, sameEntryAction,
} from './draft-actions';
import { formatDayShort } from '@/lib/time';
import type { DraftEntry, DraftHold } from '@/lib/draft-entries';
import { mapsUrl } from '@/lib/place';
import { PlaceText } from '@/components/place-name';

/* ===========================================================================
   Drafts on Entries: rows the AI read off inbox photos.

   MOST NEVER STAY HERE. A row the rules allow (lib/draft-entries) is made
   into an entry by itself — when its photo is read, or by this component the
   moment Entries opens, for anything still waiting. While that runs, one
   line says so.

   WHAT IS LISTED is what was held back for a person: a payment that looks
   like one already on file, a date that could not be trusted, a reading
   with no amount. Each says why, and offers the answer — "Same entry" puts
   the draft away and gives its photo to the entry it matched; "Add" makes
   it an entry regardless; "Finish" opens the ordinary form filled in from
   the photo. ✕ takes it off this list; the photo stays in the inbox.

   They LOOK unfinished on purpose — a dashed outline, no fill, a "Draft"
   mark, the amount in a lighter ink — so a draft is never mistaken for an
   entry that counts.

   With PHOTO_AUTO_ADD=off nothing is added unasked, and every draft is
   listed with Add or Finish, as before.
   =========================================================================== */

const HELD: Record<DraftHold, string> = {
  'no-amount': 'No amount could be read',
  date: 'The date could not be trusted — check it',
  unreadable: 'Could not tell what paid, or what it was for',
  duplicate: 'Already recorded',
  'maybe-duplicate': 'Maybe already recorded',
};

const clock = (ts: string) => {
  const t = ts.slice(11, 16);
  // Noon and midnight are what an entry with no time is stored at.
  return t === '12:00' || t === '00:00' ? '' : ` · ${t}`;
};

const SHOWN = 4;

export function DraftEntries({
  drafts, defaultTs, auto, stale = 0,
}: {
  drafts: DraftEntry[];
  defaultTs: string;
  /** Rows the rules allow are added without asking. */
  auto: boolean;
  /** Rows whose entry already exists and only need putting away. */
  stale?: number;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState<DraftEntry | null>(null);
  // Adding by itself did not get through them all: list them to add by hand.
  const [gaveUp, setGaveUp] = useState(false);
  const [addedSoFar, setAddedSoFar] = useState(0);
  const running = useRef(false);

  const adding = auto && !gaveUp;
  const waiting = adding ? drafts.filter((d) => d.auto.add).length : 0;
  const listed = adding ? drafts.filter((d) => !d.auto.add) : drafts;
  const work = adding ? waiting + stale : 0;

  /* Whatever can be added without asking, added now — a few per request so
     a long backlog never runs into a time limit — then the page is read
     again. A pass that adds nothing stops the loop: those rows are listed. */
  useEffect(() => {
    if (work === 0 || running.current) return;
    running.current = true;
    void (async () => {
      let total = 0;
      let stuck = false;
      try {
        for (;;) {
          const r = await autoAddDraftsAction({});
          if (!r.ok) { notify('error', r.error); stuck = true; break; }
          total += r.data.added;
          setAddedSoFar(total);
          if (r.data.left === 0) break;
          if (r.data.added === 0) { stuck = true; break; }
        }
      } catch {
        stuck = true;
      }
      if (total > 0) notify('success', `Added ${total} ${total === 1 ? 'entry' : 'entries'} from your photos.`);
      if (stuck) setGaveUp(true);
      running.current = false;
      router.refresh();
    })();
  }, [work, notify, router]);

  if (listed.length === 0 && waiting === 0) return null;
  const shown = all ? listed : listed.slice(0, SHOWN);

  const days: { day: string; rows: DraftEntry[] }[] = [];
  for (const d of shown) {
    const day = d.ts.slice(0, 10);
    const last = days.at(-1);
    if (last && last.day === day) last.rows.push(d); else days.push({ day, rows: [d] });
  }

  function run(d: DraftEntry, act: 'add' | 'hide' | 'same') {
    setBusy(d.key);
    start(async () => {
      const ref = { captureId: d.captureId, raw: d.raw };
      const r = act === 'add' ? await addDraftEntryAction(ref)
        : act === 'same' ? await sameEntryAction(ref)
        : await hideDraftAction(ref);
      setBusy(null);
      if (!r.ok) { notify('error', r.error); return; }
      notify('success', act === 'add'
        ? `Added “${d.remarks || d.category || 'the entry'}” to your entries.`
        : act === 'same'
          ? 'Not added — it is the entry you already have.'
          : 'Hidden here. The photo is still in the inbox.');
      router.refresh();
    });
  }

  return (
    <section
      aria-label="Draft entries from photos"
      className="mb-4 rounded-[var(--radius-card)] border border-dashed border-[var(--color-line-strong)] p-3 sm:p-4"
    >
      {waiting > 0 ? (
        <p className="flex items-center gap-2 text-sm font-medium" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent)]" aria-hidden="true" />
          Adding {waiting} {waiting === 1 ? 'entry' : 'entries'} from your photos…
          {addedSoFar > 0 ? <span className="text-[11px] font-normal text-[var(--color-ink-3)]">{addedSoFar} done</span> : null}
        </p>
      ) : null}

      {listed.length > 0 ? (
        <div className={cx('flex flex-wrap items-center gap-x-2 gap-y-1', waiting > 0 && 'mt-3')}>
          <Sparkles className="h-4 w-4 text-[var(--color-accent)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold">
            {adding
              ? `${listed.length} from your photos ${listed.length === 1 ? 'needs' : 'need'} you`
              : `${listed.length} ${listed.length === 1 ? 'draft' : 'drafts'} from your photos`}
          </h2>
          <span className="text-[11px] text-[var(--color-ink-3)]">
            {adding ? 'Read by AI · not added, for the reason shown' : 'Read by AI · not saved until you add them'}
          </span>
        </div>
      ) : null}

      <div className="mt-2 flex flex-col">
        {days.map((g) => (
          <section key={g.day}>
            <h3 className="pb-1 pt-2 text-[11px] font-medium text-[var(--color-ink-3)]">{formatDayShort(g.day)}</h3>
            <ul className="flex flex-col gap-1.5">
              {g.rows.map((d) => {
                const working = busy === d.key;
                return (
                  <li
                    key={d.key}
                    className="flex gap-2.5 rounded-[var(--radius-field)] border border-dashed border-[var(--color-line)] bg-[var(--color-canvas)]/40 px-2.5 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => setEditing(d)}
                      aria-label="Open with the photo"
                      className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-[var(--color-line)] opacity-80"
                    >
                      <SafeImage src={captureSrc(d.captureId)} alt="" className="h-full w-full object-cover" />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                          <span className="min-w-0 truncate text-sm text-[var(--color-ink-2)]">{d.remarks || d.category || 'Unnamed'}</span>
                          <span className="shrink-0 rounded-full border border-dashed border-[var(--color-accent)] px-1.5 text-[10px] font-medium leading-4 text-[var(--color-accent)]">
                            Draft
                          </span>
                          <TagChips tags={d.tags} />
                        </div>
                        {d.amount != null
                          ? <Money value={d.amount} size="sm" tone="muted" className="shrink-0" />
                          : <span className="shrink-0 text-[11px] text-[var(--color-warn)]">no amount</span>}
                      </div>
                      <div className="truncate text-[11px] text-[var(--color-ink-3)]">
                        {d.ts.slice(11, 16)} ·{' '}
                        {d.category || <span className="text-[var(--color-warn)]">needs a category</span>}
                        {d.ruled ? <span className="text-[var(--color-accent)]" title={`From your rule “${d.ruled}”`}> (your rule)</span> : null} ·{' '}
                        {d.method || <span className="text-[var(--color-warn)]">needs a payment</span>}
                      </div>
                      {d.duplicateOf ? (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--color-warn)]">
                          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">
                            {!d.duplicateOf.id ? 'Same as another photo' : d.duplicateOf.sure ? 'Already recorded' : 'Maybe already recorded'}: {d.duplicateOf.remarks} · {d.duplicateOf.method || 'no payment'}{clock(d.duplicateOf.ts)}
                          </span>
                        </div>
                      ) : adding && !d.auto.add ? (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--color-warn)]">
                          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{HELD[d.auto.why]}</span>
                        </div>
                      ) : d.dateNote ? (
                        <div className="mt-0.5 truncate text-[11px] text-[var(--color-ink-3)]">{d.dateNote}</div>
                      ) : null}
                      {d.place ? (
                        <a
                          href={mapsUrl(d.place)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 flex w-fit max-w-full items-center gap-1 text-[11px] text-[var(--color-ink-3)] hover:text-[var(--color-accent)]"
                        >
                          <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="sensitive truncate">Spent at <PlaceText place={d.place} area /></span>
                        </a>
                      ) : null}

                      <div className="mt-1.5 flex items-center justify-end gap-1">
                        <button type="button" disabled={busy !== null} onClick={() => run(d, 'hide')}
                          className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs text-[var(--color-ink-3)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]">
                          <X className="h-3.5 w-3.5" aria-hidden="true" /> Hide
                        </button>
                        {d.duplicateOf && d.amount != null ? (
                          <>
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => run(d, 'add')}
                              className={cx(
                                'inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs font-medium disabled:opacity-50',
                                d.duplicateOf.sure
                                  ? 'text-[var(--color-ink-2)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]'
                                  : 'border border-[var(--color-accent)] text-[var(--color-accent)]',
                              )}
                            >
                              <Check className="h-3 w-3" aria-hidden="true" /> Add anyway
                            </button>
                            <button
                              type="button"
                              disabled={busy !== null || !d.duplicateOf.id}
                              onClick={() => run(d, 'same')}
                              className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--color-accent)] px-3 text-xs font-medium text-[var(--color-accent-ink)] disabled:opacity-50"
                            >
                              {working ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Equal className="h-3 w-3" aria-hidden="true" />}
                              Same entry
                            </button>
                          </>
                        ) : d.complete && (!adding || d.auto.add) ? (
                          <>
                            <button type="button" onClick={() => setEditing(d)}
                              className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs text-[var(--color-ink-2)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]">
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                            </button>
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => run(d, 'add')}
                              className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--color-accent)] px-3 text-xs font-medium text-[var(--color-accent-ink)] disabled:opacity-50"
                            >
                              {working ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Check className="h-3 w-3" aria-hidden="true" />}
                              Add
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditing(d)}
                            className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--color-accent)] px-3 text-xs font-medium text-[var(--color-accent)]"
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" /> Finish
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {listed.length > SHOWN ? (
        <button type="button" onClick={() => setAll((a) => !a)}
          className={cx('mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)]')}>
          {all ? <>Show fewer <ChevronUp className="h-3.5 w-3.5" /></> : <>Show all {listed.length} <ChevronDown className="h-3.5 w-3.5" /></>}
        </button>
      ) : null}

      <TransactionDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        editing={null}
        defaultTs={editing?.ts ?? defaultTs}
        draft={editing ? {
          ts: editing.ts,
          ...(editing.amount != null ? { amount: editing.amount } : {}),
          method: editing.method,
          category: editing.category,
          remarks: editing.remarks,
          tags: editing.tags,
        } : null}
        note="A draft read from the photo. Check every field before adding."
        pendingPhoto={editing ? { id: editing.captureId, bytes: editing.bytes } : null}
        place={editing?.place ?? null}
        onSaved={(id) => {
          const d = editing;
          setEditing(null);
          if (!d || !id) { router.refresh(); return; }
          start(async () => {
            const r = await draftSavedAction({ captureId: d.captureId, raw: d.raw, transactionId: id });
            if (!r.ok) notify('error', `Entry saved, but the draft stayed: ${r.error}`);
            router.refresh();
          });
        }}
      />
    </section>
  );
}
