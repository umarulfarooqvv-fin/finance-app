'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { CheckSquare, MoveVertical, Square, X } from 'lucide-react';
import { cx } from '@/components/ui/primitives';

/* ===========================================================================
   Selecting many rows, the way every file manager does.

     click            — tick or untick one row; it becomes the anchor
     Shift + click    — everything between the anchor and this row takes the
                        anchor's state: a trip's twenty rows in two clicks
     Ctrl/⌘ + click   — tick or untick one row without touching the others
     Ctrl/⌘ + A       — select every row in view (outside a text box)
     Esc              — deselect all (when no dialog is open)

   A PHONE HAS NO SHIFT KEY, so the selection bar offers "Range": tap the
   first row, tap the last, and everything between is selected — then it
   turns itself off, so a later tap is an ordinary tap again.

   One hook for every list in the app — Entries, Import, the Inbox, the
   statement checker — so the same gesture does the same thing everywhere.
   =========================================================================== */

type Key = string | number;

/** The modifier keys a click carried. Pass the click's event straight in. */
export type ClickMods = Pick<MouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>;

export type Selection<K extends Key> = {
  selected: Set<K>;
  has: (k: K) => boolean;
  count: number;
  /** A row was clicked: handles Shift (range), Ctrl/⌘ and Range mode. */
  click: (k: K, e?: ClickMods) => void;
  /** Tick or untick several at once (a whole day, "all matching"). */
  set: (keys: K[], on: boolean) => void;
  selectAll: () => void;
  deselectAll: () => void;
  /** Every row in view is ticked. */
  allSelected: boolean;
  rangeMode: boolean;
  setRangeMode: (on: boolean) => void;
  /** Put this on a row/checkbox's onMouseDown: a Shift-click must not also
      select the page's text. */
  noTextSelect: (e: MouseEvent) => void;
};

export function useSelection<K extends Key>(
  /** The rows in the order they are shown — what a range runs along. */
  order: K[],
  opts: {
    /** Keyboard shortcuts (Ctrl/⌘+A, Esc). Off unless asked for: on a page
        with several lists, only the main one should answer Ctrl/⌘+A. */
    keys?: boolean;
    initial?: Iterable<K>;
    /** Rows that may never be ticked (already on the bill, say). */
    disabled?: (k: K) => boolean;
    /**
     * Every row a selection may hold — by default the rows in view. When it
     * changes (a new filter, a row removed), anything ticked outside it is
     * unticked. A selection must never include rows the person cannot see:
     * once it did, and a "Take off" meant for twenty rows on screen also
     * reached thirty-five from an earlier filter.
     */
    scope?: K[];
  } = {},
): Selection<K> {
  const [selected, setSelected] = useState<Set<K>>(() => new Set(opts.initial ?? []));
  const [rangeMode, setRangeModeState] = useState(false);
  const anchor = useRef<K | null>(null);
  // In Range mode the first tap only sets the anchor; the second makes the range.
  const rangeArmed = useRef(false);

  const disabled = opts.disabled;

  const scope = opts.scope ?? order;
  const scopeKey = scope.join('\u0001');
  useEffect(() => {
    const keep = new Set(scope);
    setSelected((prev) => {
      let dropped = false;
      const next = new Set<K>();
      for (const k of prev) {
        if (keep.has(k)) next.add(k);
        else dropped = true;
      }
      return dropped ? next : prev;
    });
    if (anchor.current !== null && !keep.has(anchor.current)) anchor.current = null;
    // scopeKey stands for `scope`: an array identity changes every render.
  }, [scopeKey]);
  const allowed = useCallback((k: K) => !disabled?.(k), [disabled]);

  const set = useCallback((keys: K[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (!allowed(k)) continue;
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, [allowed]);

  const click = useCallback((k: K, e?: ClickMods) => {
    const wantsRange = Boolean(e?.shiftKey) || (rangeMode && rangeArmed.current);
    // Read now: the updater below may run after the anchor has moved on.
    const from = anchor.current;
    setSelected((prev) => applyClick(prev, order, from, k, wantsRange, allowed));
    if (wantsRange && from !== null && from !== k && rangeMode) {
      setRangeModeState(false);
      rangeArmed.current = false;
    } else if (rangeMode) {
      rangeArmed.current = true;
    }
    anchor.current = k;
  }, [order, rangeMode, allowed]);

  const selectAll = useCallback(() => set(order, true), [order, set]);
  const deselectAll = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);

  const setRangeMode = useCallback((on: boolean) => {
    setRangeModeState(on);
    // Turning Range on with a row already ticked uses it as the start.
    rangeArmed.current = on && anchor.current !== null;
  }, []);

  /* Ctrl/⌘+A and Esc, for this list. Ignored while typing in a field — that
     is where Ctrl+A means "the text" — and Esc is left to an open dialog. */
  const keysOn = opts.keys ?? false;
  useEffect(() => {
    if (!keysOn) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // A tick box is not a text field: right after ticking one, Esc and
      // Ctrl/⌘+A must still reach the list.
      const box = t instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit'].includes(t.type);
      const typing = t && !box && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
      } else if (e.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]')) {
        deselectAll();
        setRangeModeState(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keysOn, selectAll, deselectAll]);

  const selectable = useMemo(() => order.filter(allowed), [order, allowed]);
  const allSelected = selectable.length > 0 && selectable.every((k) => selected.has(k));

  return {
    selected,
    has: (k) => selected.has(k),
    count: selected.size,
    click,
    set,
    selectAll,
    deselectAll,
    allSelected,
    rangeMode,
    setRangeMode,
    noTextSelect: (e) => { if (e.shiftKey) e.preventDefault(); },
  };
}

/**
 * What one click does to a selection — the rule, kept pure so it is tested.
 *
 * A plain or Ctrl/⌘ click toggles `k`. A range click (Shift, or Range mode's
 * second tap) gives every row from the anchor to `k` the ANCHOR's state, so
 * "tick one, Shift-click another" ticks both and all between, and the same
 * from an unticked anchor clears them. Rows `allowed` refuses are skipped.
 */
export function applyClick<K extends Key>(
  prev: Set<K>,
  order: K[],
  anchor: K | null,
  k: K,
  range: boolean,
  allowed: (k: K) => boolean = () => true,
): Set<K> {
  const next = new Set(prev);
  if (range && anchor !== null && anchor !== k) {
    const a = order.indexOf(anchor);
    const b = order.indexOf(k);
    if (a >= 0 && b >= 0) {
      const on = prev.has(anchor);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (const x of order.slice(lo, hi + 1)) {
        if (!allowed(x)) continue;
        if (on) next.add(x);
        else next.delete(x);
      }
      return next;
    }
  }
  if (!allowed(k)) return prev;
  if (next.has(k)) next.delete(k);
  else next.add(k);
  return next;
}

/**
 * A row's checkbox, wired to a selection. Controlled by the click — which
 * carries Shift and Ctrl/⌘ — rather than by onChange, which does not.
 */
export function SelectBox<K extends Key>({
  sel, k, label, className, disabled,
}: {
  sel: Selection<K>;
  k: K;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={sel.has(k)}
      disabled={disabled}
      readOnly
      onMouseDown={sel.noTextSelect}
      onClick={(e) => sel.click(k, e)}
      onKeyDown={(e) => {
        // Space toggles, as on any checkbox; Shift+Space extends a range.
        if (e.key === ' ') { e.preventDefault(); sel.click(k, { shiftKey: e.shiftKey, metaKey: false, ctrlKey: false }); }
      }}
      className={cx('h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-accent)]', className)}
    />
  );
}

/**
 * Select all / Deselect all / Range, and the count — the same strip on every
 * list. `extra` takes a list's own actions ("Select all 35 matching").
 */
export function SelectionControls<K extends Key>({
  sel, total, noun = 'row', nouns = `${noun}s`, extra, className, shortcuts = false,
}: {
  sel: Selection<K>;
  /** Rows in view. */
  total: number;
  noun?: string;
  nouns?: string;
  /** Whether this list answers Ctrl/⌘+A and Esc — said in the hint only if so. */
  shortcuts?: boolean;
  extra?: ReactNode;
  className?: string;
}) {
  const plural = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? noun : nouns}`;
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]', className)}>
      <span className="font-semibold text-[var(--color-ink)]">
        {sel.count > 0 ? `${sel.count.toLocaleString('en-IN')} selected` : `Select ${nouns}`}
      </span>
      <button
        type="button"
        onClick={sel.selectAll}
        disabled={total === 0 || sel.allSelected}
        className="inline-flex items-center gap-1 font-medium text-[var(--color-accent)] disabled:opacity-40"
      >
        <CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />
        Select all{total ? ` ${plural(total)}` : ''}
      </button>
      <button
        type="button"
        onClick={sel.deselectAll}
        disabled={sel.count === 0}
        className="inline-flex items-center gap-1 font-medium text-[var(--color-ink-2)] disabled:opacity-40"
      >
        <Square className="h-3.5 w-3.5" aria-hidden="true" />
        Deselect all
      </button>
      <button
        type="button"
        aria-pressed={sel.rangeMode}
        onClick={() => sel.setRangeMode(!sel.rangeMode)}
        title="Tap the first row, then the last — everything between is selected"
        className={cx(
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium',
          sel.rangeMode
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
            : 'border-[var(--color-line)] text-[var(--color-ink-2)]',
        )}
      >
        {sel.rangeMode ? <X className="h-3 w-3" aria-hidden="true" /> : <MoveVertical className="h-3 w-3" aria-hidden="true" />}
        {sel.rangeMode ? 'Range: tap the first and last' : 'Range'}
      </button>
      {extra}
      <span className="hidden text-[var(--color-ink-3)] lg:inline">
        Shift-click selects everything between · Ctrl/⌘-click one at a time
        {shortcuts ? ' · Ctrl/⌘+A all · Esc none' : ''}
      </span>
    </div>
  );
}
