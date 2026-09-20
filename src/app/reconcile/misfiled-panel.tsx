'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Search, WalletCards } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatDay, formatDayShort } from '@/lib/time';
import { round2 } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/field';
import { Badge, Dot, Money, Panel, cx } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { reassignMethodAction } from './actions';
import type { MisfiledCandidate } from '@/lib/misfiled';

/* ===========================================================================
   Everything this cycle that was paid with something else.

   The statement reconciler answers "does this bill add up", and needs a bill
   to be pasted before it can say anything. This answers a different question
   that does not need one: WHAT ELSE HAPPENED IN THIS PERIOD, and was any of it
   actually on this card?

   That is the question worth asking, because the mistake it catches cannot be
   seen anywhere else. An entry typed against Fi that was really swiped on Edge
   is correct-looking on every screen in the app — it is only wrong relative to
   a card whose list it is missing from.

   MOST OF THESE ROWS BELONG EXACTLY WHERE THEY ARE. Ninety-odd entries a cycle
   are on other methods for the ordinary reason that they were paid with other
   methods. The panel is a place to look, not a list of errors, and it says so
   rather than implying a hundred things need fixing. Hence collapsed by
   default, and filtered by method first: the question in practice is never
   "which of these 96" but "what went on Fi during the Bangalore trip".
   =========================================================================== */

export function MisfiledPanel({
  candidates,
  own = [],
  card,
  toStatement,
}: {
  candidates: MisfiledCandidate[];
  /** This card's OWN entries for the window — what is already on the bill.
      Off by default: the panel's question is about the others. Switched on,
      the cycle reads as one list instead of two lists on one screen that have
      to be held side by side in the head. */
  own?: MisfiledCandidate[];
  card: string;
  /** The statement every move here lands on — the one being viewed. Fixed, by
      construction: the window IS this cycle, so an entry dated inside it falls
      on this statement whichever card it ends up against. */
  toStatement: string;
}) {
  const router = useRouter();
  const { notify } = useToast();

  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [withOwn, setWithOwn] = useState(false);

  /* Rows already on this card, by id — the one thing the list needs to know
     about a row that cannot be "moved here" because it is already here. */
  const ownIds = useMemo(() => new Set(own.map((e) => e.id)), [own]);

  const pool = useMemo(
    () =>
      withOwn
        ? [...candidates, ...own].sort((a, b) => (a.ts < b.ts ? -1 : 1))
        : candidates,
    [candidates, own, withOwn],
  );

  /* One chip per method actually present, biggest first — the order in which
     they are worth looking through. Carries that method's card colour too,
     the same dot used on Today and Cards, so a card reads by colour rather
     than by reading its name off every chip and every row. */
  const byMethod = useMemo(() => {
    const counts = new Map<string, { n: number; total: number; color: string | null }>();
    for (const c of pool) {
      const at = counts.get(c.method) ?? { n: 0, total: 0, color: c.methodColor };
      counts.set(c.method, { n: at.n + 1, total: round2(at.total + c.amount), color: at.color });
    }
    return [...counts.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.n - a.n);
  }, [pool]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.filter(
      (c) =>
        (method === null || c.method === method) &&
        (needle === '' ||
          c.description.toLowerCase().includes(needle) ||
          c.category.toLowerCase().includes(needle)),
    );
  }, [pool, method, q]);

  /* BY DAY, ALWAYS. A flat list makes the date column repeat on every row and
     still leaves the reader finding the boundaries by eye — and the question
     asked of this list is nearly always "what happened on the 22nd". */
  const days = useMemo(() => {
    const by = new Map<string, MisfiledCandidate[]>();
    for (const c of shown) {
      const at = by.get(c.day);
      if (at) at.push(c);
      else by.set(c.day, [c]);
    }
    // `shown` is already in date order, so insertion order is chronological.
    return [...by.entries()].map(([day, items]) => ({
      day,
      items,
      total: round2(items.reduce((a, x) => a + x.amount, 0)),
    }));
  }, [shown]);

  /* What a move actually costs each bill it is taken from. Grouped by the
     statement the rows are on NOW, because that is the figure that changes on
     a card the user is not looking at — and may already have reconciled. */
  const takenFrom = useMemo(() => {
    const by = new Map<string, { label: string; n: number; total: number }>();
    for (const c of candidates) {
      if (!picked.has(c.id)) continue;
      const key = `${c.method}|${c.fromStatement ?? ''}`;
      const label = c.fromStatement
        ? `${c.method} ${statementLabel(c.fromStatement)}`
        : `${c.method} (no statement)`;
      const at = by.get(key) ?? { label, n: 0, total: 0 };
      by.set(key, { label, n: at.n + 1, total: round2(at.total + c.amount) });
    }
    return [...by.values()].sort((a, b) => b.total - a.total);
  }, [candidates, picked]);

  const total = round2(candidates.reduce((a, c) => a + c.amount, 0));
  const shownTotal = round2(shown.reduce((a, c) => a + c.amount, 0));
  /* A row already on this card cannot be moved onto it, so it is never part of
     a selection even if its box was ticked before the toggle was switched on. */
  const selected = shown.filter((c) => picked.has(c.id) && !ownIds.has(c.id));

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function moveOne(c: MisfiledCandidate) {
    setMoving(c.id);
    void reassignMethodAction({ id: c.id, method: card }).then((r) => {
      setMoving(null);
      if (!r.ok) { notify('error', r.error); return; }
      notify('success', `${c.description} moved to ${card}.`);
      router.refresh();
    });
  }

  async function moveSelected() {
    if (selected.length === 0) return;
    setBulk(true);
    let moved = 0;
    for (const c of selected) {
      const r = await reassignMethodAction({ id: c.id, method: card });
      if (r.ok) moved++;
      else notify('error', `${c.description}: ${r.error}`);
    }
    setBulk(false);
    setPicked(new Set());
    if (moved > 0) {
      notify('success', `${moved} ${moved === 1 ? 'entry' : 'entries'} moved to ${card}.`);
      router.refresh();
    }
  }

  if (candidates.length === 0) return null;

  return (
    <Panel className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <WalletCards className="h-4 w-4 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Paid with something else this cycle</span>
          <span className="block text-[11px] text-[var(--color-ink-3)]">
            {candidates.length} {candidates.length === 1 ? 'entry' : 'entries'} totalling{' '}
            <span className="sensitive num">
              {total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
            {' — '}move any that were really on {card}.
          </span>
        </span>
        <ChevronDown
          className={cx(
            'h-4 w-4 shrink-0 text-[var(--color-ink-3)] transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {!open ? null : (
        <div className="mt-3 border-t border-[var(--color-line)] pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip active={method === null} onClick={() => setMethod(null)}>
              All {candidates.length}
            </Chip>
            {byMethod.map((m) => (
              <Chip key={m.name} active={method === m.name} onClick={() => setMethod(m.name)}>
                {m.color ? <Dot color={m.color} size={7} /> : null}
                {m.name} {m.n}
              </Chip>
            ))}
          </div>

          <label className="mt-2.5 flex items-center gap-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by description or category…"
              aria-label="Filter entries"
              className={cx(inputClass(), 'text-xs')}
            />
          </label>

          {selected.length > 0 ? (
            <div className="mt-2.5 rounded-[var(--radius-field)] border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-[11px] text-[var(--color-ink-2)]">
                  {selected.length} selected, totalling{' '}
                  <span className="sensitive num font-semibold">
                    {round2(selected.reduce((a, c) => a + c.amount, 0)).toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                  {' → '}
                  {card} {statementLabel(toStatement)}
                </span>
                <Button size="sm" pending={bulk} onClick={moveSelected}>
                  Move to {card}
                </Button>
              </div>

              {/* Which bills this comes OFF. Every card bills on its own day,
                  so a move is a transfer between two statements, and the one
                  losing the charge belongs to a card not on screen. */}
              <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-[var(--color-warn)] pt-1.5">
                {takenFrom.map((g) => (
                  <li key={g.label} className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-ink-2)]">
                    <span className="min-w-0 truncate">
                      leaves {g.label} · {g.n} {g.n === 1 ? 'entry' : 'entries'}
                    </span>
                    <Money value={g.total} size="sm" tone="muted" />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-[var(--color-ink-3)]">
              {shown.length === pool.length
                ? `${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}`
                : `${shown.length} of ${pool.length}`}
              {' · '}
              <span className="sensitive num">
                {shownTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </p>
            {/* The cycle as one list. Without this the card's own entries are a
                separate panel elsewhere on the page, and comparing the two
                means holding one in your head while reading the other. */}
            {own.length > 0 ? (
              <button
                type="button"
                onClick={() => setWithOwn((v) => !v)}
                className="text-[11px] font-medium text-[var(--color-accent)]"
              >
                {withOwn ? `Hide ${card}'s own` : `Show ${card} too (${own.length})`}
              </button>
            ) : null}
          </div>

          {days.length === 0 ? (
            <p className="py-3 text-[11px] text-[var(--color-ink-3)]">Nothing matches that.</p>
          ) : (
            <div className="mt-1 max-h-[26rem] overflow-y-auto">
              {days.map((g) => (
                <section key={g.day}>
                  {/* The date once per day, not once per row. Sticky so it is
                      still on screen while reading a long day. */}
                  <h4 className="sticky top-0 z-10 flex items-baseline justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface)] py-1.5 text-[11px] font-semibold text-[var(--color-ink-2)]">
                    <span>{formatDayShort(g.day)}</span>
                    <span className="font-normal text-[var(--color-ink-3)]">
                      {g.items.length} &middot;{' '}
                      <span className="sensitive num">
                        {g.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </span>
                  </h4>

                  <ul className="flex flex-col">
                    {g.items.map((c) => {
                      const mine = ownIds.has(c.id);
                      return (
                        <li
                          key={c.id}
                          className={cx(
                            'flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 last:border-b-0',
                            mine && 'bg-[var(--color-raised)]',
                          )}
                        >
                          {/* Already on this card: nothing to tick, because
                              there is nowhere to move it to. */}
                          {mine ? (
                            <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                          ) : (
                            <input
                              type="checkbox"
                              checked={picked.has(c.id)}
                              onChange={() => toggle(c.id)}
                              aria-label={`Select ${c.description}`}
                              className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {c.description}
                            <span className="ml-1.5 text-[11px] text-[var(--color-ink-3)]">
                              {c.category}
                            </span>
                          </span>
                          {/* The bill it is on now, in that card's own colour.
                              Its card bills on a different day from this one,
                              so this is a different statement, not the same
                              period under another name. */}
                          <Badge tone={mine ? 'good' : 'neutral'}>
                            {c.methodColor ? <Dot color={c.methodColor} size={7} /> : null}
                            {c.method}
                            {!mine && c.fromStatement ? ` \u00b7 ${statementLabel(c.fromStatement)}` : ''}
                          </Badge>
                          <Money
                            value={c.amount}
                            size="sm"
                            tone={c.direction === 'credit' ? 'credit' : 'debt'}
                          />
                          {mine ? (
                            <span className="text-[11px] text-[var(--color-ink-3)]">on this bill</span>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={moving === c.id}
                              onClick={() => moveOne(c)}
                            >
                              Move to {card}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <p className="mt-2.5 border-t border-[var(--color-line)] pt-2.5 text-[11px] text-[var(--color-ink-3)]">
            Each card bills on its own day, so the date beside a card name is the statement that
            entry is on today — moving it takes the charge off that bill and puts it on{' '}
            {card}&rsquo;s {statementLabel(toStatement)}. Card bill payments are left out:
            re-filing one would say this card paid another card&rsquo;s bill, not that a purchase
            was on it. A move changes only the payment method; the amount, date, category and
            remarks stay as recorded.
          </p>
        </div>
      )}
    </Panel>
  );
}

/** "14 Sep" — the statement's own date, without the year the row has no room for. */
function statementLabel(day: string): string {
  return formatDay(day).replace(/\s\d{4}$/, '');
}

function Chip({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)]',
      )}
    >
      {children}
    </button>
  );
}
