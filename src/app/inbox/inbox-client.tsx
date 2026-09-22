'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Plus, RotateCw, Sparkles, Trash2, X } from 'lucide-react';
import { formatDayShort } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { cx, Empty } from '@/components/ui/primitives';
import { SafeImage } from '@/components/capture-image';
import { TransactionDialog } from '@/app/transactions/transaction-dialog';
import { discardCaptureAction, linkCaptureAction } from './actions';
import { IMPORT_DRAFT_KEY } from '@/lib/import-handoff';

/* ===========================================================================
   Photos waiting to become entries.

   The photo is the prompt, not the data — and with IMPORT_AI set, the reading
   has usually already happened: /api/capture reads each photo into rows the
   moment it lands, so this page opens with "3 rows ready" rather than a
   picture to squint at. Anything that missed that read (it arrived while the
   provider was off, or the read failed) is picked up here on arrival.

   WHAT IT PRODUCES IS STILL A DRAFT. Sending rows to /import writes nothing:
   they land in the same table a paste lands in, to be read, corrected and
   confirmed. A photo stops waiting only once an entry actually exists.

   With no provider configured this is exactly what it always was: a picture,
   and the ordinary entry form to type what it says.
   =========================================================================== */

export type Capture = {
  id: string;
  ts: string;
  note: string;
  bytes: number;
  /** Rows the AI read out of this photo, when it has been read. */
  draft: string | null;
  /** Why it could not be read, when that is what happened. */
  draftError: string | null;
};

type DraftState = { text?: string; error?: string };

/** How many unread photos one visit will read. A backlog of fifty should not
    fire fifty calls at a free tier the moment the page opens. */
const AUTO_READ_LIMIT = 8;

const rowCount = (text: string) => text.split('\n').filter((l) => l.trim()).length;

export function InboxClient({
  captures, defaultTs, visionEnabled, visionLabel,
}: {
  captures: Capture[];
  defaultTs: string;
  /** Whether IMPORT_AI is configured to read a photo directly. */
  visionEnabled: boolean;
  visionLabel: string;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();

  const [entryFor, setEntryFor] = useState<Capture | null>(null);
  const [confirming, setConfirming] = useState<Capture | null>(null);
  const [zoomed, setZoomed] = useState<Capture | null>(null);

  /* Several photos can go to /import in one trip — a busy week's worth of
     receipts, not just one at a time. Nothing is ticked by default, and an
     empty selection means "everything that is ready". */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /* What has been read, starting from what the server already had. Kept here
     as well so a read finishing on this page updates the tile without a
     round trip through the server component. */
  const [drafts, setDrafts] = useState<Record<string, DraftState>>(() => {
    const seed: Record<string, DraftState> = {};
    for (const c of captures) {
      if (c.draft) seed[c.id] = { text: c.draft };
      else if (c.draftError) seed[c.id] = { error: c.draftError };
    }
    return seed;
  });
  const [reading, setReading] = useState<Set<string>>(new Set());

  const toggleSelected = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Read these photos into rows, and remember the answers. */
  async function read(ids: string[], refresh = false) {
    if (ids.length === 0) return;
    setReading((r) => new Set([...r, ...ids]));
    try {
      const res = await fetch('/api/inbox/convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, refresh }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        drafts?: Record<string, DraftState>;
        error?: string;
      };
      if (!json.ok || !json.drafts) {
        // Recorded per photo rather than as a toast: a failure that belongs to
        // one picture should be visible ON that picture when the page is next
        // opened, not in a message that has since been dismissed.
        const error = json.error ?? 'Could not read that photo.';
        setDrafts((d) => {
          const next = { ...d };
          for (const id of ids) if (!next[id]?.text) next[id] = { error };
          return next;
        });
        return;
      }
      setDrafts((d) => ({ ...d, ...json.drafts }));
    } catch {
      setDrafts((d) => {
        const next = { ...d };
        for (const id of ids) if (!next[id]?.text) next[id] = { error: 'Could not reach the server.' };
        return next;
      });
    } finally {
      setReading((r) => {
        const next = new Set(r);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  }

  /* Anything that arrived without being read — while the provider was off, or
     before any of this existed — is read on arrival here instead. Runs once
     per set of photos rather than on every render, which the ref guards. */
  const autoRead = useRef(false);
  useEffect(() => {
    if (!visionEnabled || autoRead.current) return;
    const unread = captures
      .filter((c) => !c.draft && !c.draftError)
      .slice(0, AUTO_READ_LIMIT)
      .map((c) => c.id);
    if (unread.length === 0) return;
    autoRead.current = true;
    void read(unread);
  }, [visionEnabled, captures]);

  const readyIds = captures.filter((c) => drafts[c.id]?.text).map((c) => c.id);
  /* Ticking nothing means "send everything that is ready" — the common case
     is a handful of photos from one afternoon, all of them wanted. */
  const sendIds = selected.size > 0
    ? [...selected].filter((id) => drafts[id]?.text)
    : readyIds;
  const sendRows = sendIds.reduce((n, id) => n + rowCount(drafts[id]?.text ?? ''), 0);

  /** Hand the rows to /import. Writes nothing: the capture stays waiting
      until the entries it becomes are actually saved there. */
  function sendToImport() {
    if (sendIds.length === 0) return;
    const text = sendIds.map((id) => drafts[id]?.text ?? '').filter(Boolean).join('\n');
    try {
      sessionStorage.setItem(IMPORT_DRAFT_KEY, JSON.stringify({ text, captureIds: sendIds }));
    } catch {
      // Private browsing: the rows cannot be carried across, so say so rather
      // than landing on an empty /import with no explanation.
      notify('error', 'This browser will not carry the rows across. Copy them by hand instead.');
      return;
    }
    router.push('/import');
  }

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
      {visionEnabled ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2.5">
          <Button size="sm" disabled={sendIds.length === 0} onClick={sendToImport}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {sendIds.length === 0
              ? 'Nothing read yet'
              : `Review ${sendRows} ${sendRows === 1 ? 'row' : 'rows'} from ${sendIds.length} ${sendIds.length === 1 ? 'photo' : 'photos'}`}
          </Button>
          {selected.size > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear the {selected.size} ticked
            </Button>
          ) : null}
          <span className="min-w-0 flex-1 text-[11px] text-[var(--color-ink-3)]">
            {reading.size > 0
              ? `Reading ${reading.size} ${reading.size === 1 ? 'photo' : 'photos'}…`
              : selected.size > 0
                ? 'Only the ticked photos. Nothing is saved until you confirm on the next screen.'
                : 'Every photo that has been read. Nothing is saved until you confirm on the next screen.'}
            {' '}Read by {visionLabel}.
          </span>
        </div>
      ) : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {captures.map((c) => (
          <li
            key={c.id}
            className={cx(
              'flex flex-col overflow-hidden rounded-[var(--radius-field)] border',
              selected.has(c.id) ? 'border-[var(--color-accent)]' : 'border-[var(--color-line)]',
            )}
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--color-raised)]">
              {/* Sibling of the button, not nested inside it — an input inside
                  a button is invalid HTML, and a couple of browsers let the
                  button's own click win over the checkbox's, which would make
                  it untoggleable rather than merely ugly markup. */}
              {visionEnabled ? (
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggleSelected(c.id)}
                  aria-label={`Select the photo from ${formatDayShort(c.ts.slice(0, 10))} for import`}
                  className="absolute left-2 top-2 z-10 h-4 w-4 accent-[var(--color-accent)]"
                />
              ) : null}
              <button
                type="button"
                onClick={() => setZoomed(c)}
                className="h-full w-full"
                aria-label={`View the photo from ${formatDayShort(c.ts.slice(0, 10))}`}
              >
                {/* A plain <img>, not next/image: the bytes come from a
                    session-guarded route rather than an origin the optimiser
                    can be configured for, and optimising would mean a second
                    service fetching a picture of somebody's bill. */}
                <SafeImage
                  src={`/api/capture/${c.id}`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-2 p-2.5">
              <div className="min-w-0">
                <div className="num text-xs font-medium">{formatDayShort(c.ts.slice(0, 10))}</div>
                <div className="num text-[11px] text-[var(--color-ink-3)]">
                  {c.ts.slice(11, 16)} · {Math.max(1, Math.round(c.bytes / 1024))} KB
                </div>
                {c.note ? (
                  <p className="mt-1 line-clamp-2 text-[11px] text-[var(--color-ink-2)]">{c.note}</p>
                ) : null}

                {/* What the AI made of it, on the photo itself — a reading
                    that failed belongs on the picture it failed to read,
                    where it is still there on the next visit. */}
                {visionEnabled ? (
                  <div className="mt-1.5 text-[11px]">
                    {reading.has(c.id) ? (
                      <span className="flex items-center gap-1 text-[var(--color-ink-3)]">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        Reading…
                      </span>
                    ) : drafts[c.id]?.text ? (
                      <span className="text-[var(--color-pos)]">
                        {rowCount(drafts[c.id]!.text!)}{' '}
                        {rowCount(drafts[c.id]!.text!) === 1 ? 'row read' : 'rows read'}
                      </span>
                    ) : drafts[c.id]?.error ? (
                      <span className="flex flex-wrap items-center gap-1 text-[var(--color-warn)]">
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="line-clamp-2">{drafts[c.id]!.error}</span>
                        <button
                          type="button"
                          onClick={() => void read([c.id], true)}
                          className="inline-flex items-center gap-0.5 text-[var(--color-accent)]"
                        >
                          <RotateCw className="h-3 w-3" aria-hidden="true" />
                          Retry
                        </button>
                      </span>
                    ) : (
                      <span className="text-[var(--color-ink-3)]">Not read yet</span>
                    )}
                  </div>
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
