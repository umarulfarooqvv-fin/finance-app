'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { inputClass } from '@/components/ui/field';
import { Badge, Empty, Money, Panel, Stat, StatGrid, cx } from '@/components/ui/primitives';
import { Private } from '@/contexts/privacy-context';
import { dayOf, formatDay } from '@/lib/time';
import {
  viewCredit, type CreditGroup, type CreditGroupBy, type CreditPerson, type CreditStatus,
} from '@/lib/credit-view';

type Sort = 'outstanding' | 'lent' | 'recent' | 'name';

const SORTS: Record<Sort, (a: CreditGroup, b: CreditGroup) => number> = {
  outstanding: (a, b) => b.totals.outstanding - a.totals.outstanding || b.totals.lent - a.totals.lent,
  lent: (a, b) => b.totals.lent - a.totals.lent,
  recent: (a, b) => ((a.last ?? '') < (b.last ?? '') ? 1 : (a.last ?? '') > (b.last ?? '') ? -1 : 0),
  name: (a, b) => a.label.localeCompare(b.label),
};

function Segmented<T extends string>({
  value, onChange, options, label,
}: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-[var(--radius-field)] border border-[var(--color-line)] p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cx(
            'rounded-[calc(var(--radius-field)-2px)] px-2.5 py-1 text-xs font-medium',
            value === v ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink)]',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function CreditClient({ people, initialQuery }: { people: CreditPerson[]; initialQuery: string }) {
  const [q, setQ] = useState(initialQuery);
  const [status, setStatus] = useState<CreditStatus>('open');
  const [groupBy, setGroupBy] = useState<CreditGroupBy>('person');
  const [sort, setSort] = useState<Sort>('outstanding');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const view = useMemo(() => viewCredit(people, { q, status, groupBy }), [people, q, status, groupBy]);
  const groups = useMemo(() => [...view.groups].sort(SORTS[sort]), [view.groups, sort]);
  const t = view.totals;

  const toggle = (key: string) =>
    setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const allOpen = groups.length > 0 && groups.every((g) => open.has(g.label));

  return (
    <>
      <Panel>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-3)]" aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="A name, or what it was for — Ashiq, food, petrol…"
            aria-label="Search credit given by person or description"
            className={cx(inputClass(), 'pl-9 pr-9')}
          />
          {q ? (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() => setQ('')}
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-[var(--color-ink-3)] hover:bg-[var(--color-raised)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Segmented label="Which lendings" value={status} onChange={setStatus} options={[['open', 'Still owed'], ['all', 'All, incl. repaid']]} />
          <Segmented label="Group by" value={groupBy} onChange={(v) => { setGroupBy(v); setOpen(new Set()); }} options={[['person', 'By person'], ['description', 'By description']]} />
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-3)]">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-xs text-[var(--color-ink)]"
            >
              <option value="outstanding">Most owed</option>
              <option value="lent">Most lent</option>
              <option value="recent">Most recent</option>
              <option value="name">A–Z</option>
            </select>
          </label>
        </div>

        <div className="mt-4 border-t border-[var(--color-line)] pt-4">
          <StatGrid cols={3}>
            <Stat label="Lent" value={t.lent} hint={`${t.count} ${t.count === 1 ? 'entry' : 'entries'}`} />
            <Stat label="Came back" value={t.back} tone="credit" />
            <Stat
              label="Still owed"
              value={t.outstanding}
              tone="debt"
              hint={`${groups.length} ${groupBy === 'person' ? (groups.length === 1 ? 'person' : 'people') : (groups.length === 1 ? 'description' : 'descriptions')}`}
            />
          </StatGrid>
        </div>
      </Panel>

      <Panel className="mt-4">
        {groups.length === 0 ? (
          <Empty
            title={q ? 'Nothing matches' : 'Nothing outstanding'}
            hint={q
              ? (status === 'open' ? 'Try “All, incl. repaid” — it may have been paid back.' : 'No person or description contains that.')
              : 'Entries with the Credit Given category appear here.'}
          />
        ) : (
          <>
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.label)))}
                className="text-xs font-medium text-[var(--color-accent)] hover:underline"
              >
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
            <ul className="flex flex-col">
              {groups.map((g) => (
                <GroupRow key={g.label} g={g} groupBy={groupBy} open={open.has(g.label)} onToggle={() => toggle(g.label)} />
              ))}
            </ul>
          </>
        )}
        <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
          Repayments settle the oldest lending first. &ldquo;Came back&rdquo; is what was recorded as
          returned — cash handed back without being logged still reads as owed.
        </p>
      </Panel>
    </>
  );
}

function GroupRow({ g, groupBy, open, onToggle }: { g: CreditGroup; groupBy: CreditGroupBy; open: boolean; onToggle: () => void }) {
  const settled = g.totals.outstanding <= 0.005;
  return (
    <li className="border-b border-[var(--color-line)] last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2 py-2.5 text-left text-sm hover:bg-[var(--color-raised)]"
      >
        {open
          ? <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
          : <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium"><Private>{g.label}</Private></span>
          <span className="block truncate text-[11px] text-[var(--color-ink-3)]">
            {g.totals.count} {g.totals.count === 1 ? 'entry' : 'entries'}
            {groupBy === 'description' ? <> · <Private>{g.people.join(', ')}</Private></> : null}
            {g.last ? ` · last ${formatDay(dayOf(g.last))}` : ''}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          {settled
            ? <Badge tone="good">Repaid</Badge>
            : <Money value={g.totals.outstanding} size="md" tone="debt" className="font-semibold" />}
          <span className="text-[11px] text-[var(--color-ink-3)]">
            of <Money value={g.totals.lent} size="sm" tone="muted" />
          </span>
        </span>
      </button>

      {open ? <GroupDetail g={g} groupBy={groupBy} /> : null}
    </li>
  );
}

/** One group's entries and repayments, grouped by day, newest first. */
function GroupDetail({ g, groupBy }: { g: CreditGroup; groupBy: CreditGroupBy }) {
  type Line =
    | { kind: 'lent'; ts: string; id: string; amount: number; outstanding: number; text: string; sub: string }
    | { kind: 'back'; ts: string; id: string; amount: number; text: string; sub: string };
  const lines: Line[] = [
    ...g.entries.map((e): Line => ({
      kind: 'lent', ts: e.ts, id: e.id, amount: e.amount, outstanding: e.outstanding,
      text: groupBy === 'person' ? (e.remarks || '(no description)') : e.person,
      sub: e.method,
    })),
    ...g.repayments.map((x): Line => ({
      kind: 'back', ts: x.ts, id: x.id, amount: x.amount, text: x.note || 'Repayment', sub: 'came back',
    })),
  ].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  const days: { day: string; lines: Line[] }[] = [];
  for (const l of lines) {
    const d = dayOf(l.ts as never);
    const last = days[days.length - 1];
    if (last && last.day === d) last.lines.push(l);
    else days.push({ day: d, lines: [l] });
  }

  const q = groupBy === 'person' ? g.label : '';
  return (
    <div className="mb-3 ml-6 rounded-[var(--radius-field)] border border-[var(--color-line)]">
      {days.map((d) => (
        <div key={d.day}>
          <div className="bg-[var(--color-raised)] px-3 py-1 text-[11px] font-medium text-[var(--color-ink-3)]">
            {formatDay(d.day)}
          </div>
          <ul>
            {d.lines.map((l) => (
              <li key={`${l.kind}-${l.id}`} className="flex items-center gap-2 border-t border-[var(--color-line)] px-3 py-1.5 text-xs first:border-t-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate"><Private>{l.text}</Private></span>
                  <span className="block text-[10px] text-[var(--color-ink-3)]">{l.sub}</span>
                </span>
                {l.kind === 'lent' ? (
                  <span className="flex shrink-0 flex-col items-end">
                    <Money value={l.amount} size="sm" />
                    {l.outstanding <= 0.005
                      ? <span className="text-[10px] text-[var(--color-pos)]">repaid</span>
                      : l.outstanding < l.amount
                        ? <span className="text-[10px] text-[var(--color-ink-3)]"><Money value={l.outstanding} size="sm" tone="debt" /> left</span>
                        : null}
                  </span>
                ) : (
                  <Money value={-l.amount} size="sm" tone="credit" className="shrink-0" />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {q ? (
        <div className="border-t border-[var(--color-line)] px-3 py-1.5 text-right">
          <Link
            href={`/transactions?cat=${encodeURIComponent('Credit Given')}&q=${encodeURIComponent(q)}`}
            className="text-[11px] font-medium text-[var(--color-accent)] hover:underline"
          >
            Open in Entries →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
