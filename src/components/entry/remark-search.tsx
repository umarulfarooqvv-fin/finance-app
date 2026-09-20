'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { History, RotateCw } from 'lucide-react';
import type { RemarkSuggestion } from '@/app/api/remarks/route';
import { nextInSeries } from '@/lib/recurring';
import { looseIncludes } from '@/lib/search-text';
import { Badge, cx } from '@/components/ui/primitives';
import { inputClass } from '@/components/ui/field';

/* ===========================================================================
   The remarks field, with everything already typed behind it.

   Consistency in this ledger is won or lost here. "Kseb bill", "KSEB Bill
   Payment" and "kseb electricity" are three different things to every total on
   every page, and the divergence is never noticed at the moment it is typed —
   only months later, when a category looks wrong and nobody can say why.

   So typing searches what is there, and picking a past remark brings its
   CATEGORY with it. That is the half that matters most: a phrase reused under
   a different category is a worse inconsistency than a phrase spelled two
   ways, because it moves money between totals rather than just splitting one.

   AND IT MOVES A SERIES ON. The most-retyped remarks in this ledger are the
   ones that change by one — "Sheya's 23/24 Emi", "Ipad Mini 18/24" — so the
   advanced form is offered above the original rather than left to be edited
   by hand, which is where a series quietly breaks.

   It only ever fills the form. Nothing here writes, and a picked suggestion
   can be typed straight over.
   =========================================================================== */

type Filled = { remarks: string; category: string };

export function RemarkSearch({
  value, onChange, onPick, error, id,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Picked a past remark: its category comes too, for the form to apply. */
  onPick: (filled: Filled) => void;
  error?: string;
  id: string;
}) {
  const [all, setAll] = useState<RemarkSuggestion[] | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  /* Fetched once, on first focus rather than on mount. The list is the user's
     whole history of descriptions and most entries never open it — a voice
     entry or a statement draft arrives with the field already filled. */
  useEffect(() => {
    if (!open || all !== null) return;
    let live = true;
    void fetch('/api/remarks')
      .then((r) => r.json())
      .then((j: { ok: boolean; suggestions?: RemarkSuggestion[] }) => {
        if (live) setAll(j.ok && j.suggestions ? j.suggestions : []);
      })
      .catch(() => live && setAll([]));
    return () => { live = false; };
  }, [open, all]);

  // Clicking away closes the list; the typed text is kept either way.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const matches = useMemo(() => {
    if (!all) return [];
    /* Folded both sides: these remarks came through a Google Sheet, which
       curls an apostrophe as it is typed, so "Sheya's" typed here would never
       find "Sheya’s" stored there. */
    const pool = all.filter((s) => looseIncludes(s.remarks, value));

    /* Each match, plus the next in its series where there is one.

       A "next" THAT ALREADY EXISTS IS NOT OFFERED. Sheya's instalments run to
       6/6, so 5/6 proposes 6/6 — which is already recorded, and taking the
       offer would enter that instalment a second time. An existing remark has
       its own row in this list; proposing it again as though it were new is
       both noise and a way to double an entry. */
    const known = new Set(all.map((s) => s.remarks));
    const out: { s: RemarkSuggestion; next: string | null }[] = [];
    for (const s of pool.slice(0, 40)) {
      const next = nextInSeries(s.remarks);
      out.push({ s, next: next && !known.has(next) ? next : null });
    }
    return out;
  }, [all, value]);

  const choose = (remarks: string, category: string) => {
    onPick({ remarks, category });
    setOpen(false);
  };

  return (
    <div className="relative" ref={box}>
      <input
        id={id}
        name="remarks"
        value={value}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        placeholder="What was it for?"
        aria-expanded={open}
        aria-controls={`${id}-past`}
        className={inputClass(error)}
      />

      {open ? (
        <div
          id={`${id}-past`}
          role="listbox"
          aria-label="Descriptions used before"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg"
        >
          {all === null ? (
            <p className="px-3 py-2 text-[11px] text-[var(--color-ink-3)]">Reading what you have used before&hellip;</p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-[var(--color-ink-3)]">
              Nothing like that has been used before. Typing it makes it the first.
            </p>
          ) : (
            <ul className="flex flex-col">
              {matches.map(({ s, next }) => (
                <li key={s.remarks} className="flex flex-col border-b border-[var(--color-line)] last:border-b-0">
                  {next ? (
                    <Row
                      remarks={next}
                      category={s.category}
                      note={`next after ${s.remarks}`}
                      lead
                      onPick={() => choose(next, s.category)}
                    />
                  ) : null}
                  <Row
                    remarks={s.remarks}
                    category={s.category}
                    note={`${s.method} · used ${s.used}${s.used === 1 ? ' time' : ' times'}`}
                    onPick={() => choose(s.remarks, s.category)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Row({
  remarks, category, note, lead, onPick,
}: {
  remarks: string;
  category: string;
  note: string;
  lead?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      onClick={onPick}
      className={cx(
        'flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-left transition-colors hover:bg-[var(--color-raised)]',
        lead ? 'bg-[var(--color-accent-soft)]' : '',
      )}
    >
      {lead ? (
        <RotateCw className="h-3 w-3 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
      ) : (
        <History className="h-3 w-3 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-xs">{remarks}</span>
      <Badge tone={lead ? 'accent' : 'neutral'}>{category}</Badge>
      <span className="w-full pl-5 text-[10px] text-[var(--color-ink-3)]">{note}</span>
    </button>
  );
}
