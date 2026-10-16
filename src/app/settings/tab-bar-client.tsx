'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Lock, Minus, Plus, RotateCcw } from 'lucide-react';
import {
  ALL_NAV_ITEMS, HOME_HREF, MAX_TABS, MIN_TABS, PRIMARY_NAV_ITEMS, TABS_EVENT,
  tabsCookie, tabsFrom, tabsModeCookie, type NavItem, type TabsMode,
} from '@/lib/nav-sections';
import { parseVisits, rankedPages } from '@/lib/page-history';
import { cx } from '@/components/ui/primitives';

/* ===========================================================================
   Arranging the phone tab bar: which pages get a tab, and in what order.

   Today is pinned first in every mode. "Most used first" orders the rest by
   how much each page is opened lately (lib/page-history), re-ordered when the
   app opens — never mid-session, so a tab does not move between two taps.

   Every change applies at once — the bar at the bottom of the screen IS the
   preview. Up/down buttons rather than drag, because a drag inside a page
   that scrolls is a fight with the thumb on a phone.
   =========================================================================== */

const iconBtn =
  'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--color-ink-2)] hover:bg-[var(--color-raised)] disabled:opacity-30 disabled:hover:bg-transparent';

function usedNow(): string {
  try { return rankedPages(parseVisits(localStorage.getItem('pfm:visits')), 10).join(','); } catch { return ''; }
}

export function TabBarSettings({ current, mode: initialMode }: { current: string | null; mode: TabsMode }) {
  const router = useRouter();
  const [tabs, setTabs] = useState<NavItem[]>(() => tabsFrom(current));
  const [mode, setMode] = useState<TabsMode>(initialMode);
  const [rank, setRank] = useState('');
  useEffect(() => { setRank(usedNow()); }, []);

  function save(next: NavItem[], nextMode: TabsMode = mode) {
    const fixed = tabsFrom(next.map((i) => i.href).join(','));
    setTabs(fixed);
    setMode(nextMode);
    const order = fixed.map((i) => i.href).join(',');
    document.cookie = tabsCookie(fixed.map((i) => i.href));
    document.cookie = tabsModeCookie(nextMode);
    window.dispatchEvent(new CustomEvent(TABS_EVENT, { detail: { order, mode: nextMode } }));
    // The bar is rendered by the server layout from the cookies.
    router.refresh();
  }

  const move = (i: number, by: -1 | 1) => {
    const next = [...tabs];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    save(next);
  };
  // "First" means first after Today, which never moves.
  const toFirst = (i: number) => {
    const next = [...tabs];
    const [item] = next.splice(i, 1);
    save([next[0]!, item!, ...next.slice(1)]);
  };

  const inBar = new Set(tabs.map((t) => t.href));
  const rest = ALL_NAV_ITEMS.filter((i) => !inBar.has(i.href));
  const full = tabs.length >= MAX_TABS;
  const isDefault = mode === 'fixed'
    && tabs.map((t) => t.href).join() === PRIMARY_NAV_ITEMS.map((t) => t.href).join();
  const preview = mode === 'auto' ? tabsFrom(tabs.map((t) => t.href).join(','), { mode, rank }) : null;

  return (
    <div>
      <div role="group" aria-label="Tab order" className="mb-3 inline-flex rounded-[var(--radius-field)] border border-[var(--color-line)] p-0.5">
        {([['fixed', 'My order'], ['auto', 'Most used first']] as const).map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={mode === v}
            onClick={() => save(tabs, v)}
            className={cx(
              'rounded-[calc(var(--radius-field)-2px)] px-3 py-1 text-xs font-medium',
              mode === v ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink)]',
            )}
          >
            {text}
          </button>
        ))}
      </div>

      {preview ? (
        <div className="mb-4 rounded-[var(--radius-field)] bg-[var(--color-raised)] p-3">
          <p className="text-xs text-[var(--color-ink-2)]">
            Today stays first; after it come the pages you open most lately. The order is set each
            time the app opens, so tabs never move while you are using it. Until there is enough
            history, the list below fills the gaps.
          </p>
          <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
            Right now: {preview.map((p) => p.label).join(' · ')}
          </p>
        </div>
      ) : null}

      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
          {mode === 'auto' ? 'Fills the gaps' : 'In the tab bar'} &middot; {tabs.length} of {MAX_TABS}
        </span>
        <button
          type="button"
          disabled={isDefault}
          onClick={() => save(PRIMARY_NAV_ITEMS, 'fixed')}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:underline disabled:text-[var(--color-ink-3)] disabled:no-underline"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" /> Reset
        </button>
      </div>

      <ol className="rounded-[var(--radius-field)] border border-[var(--color-line)]">
        {tabs.map((item, i) => {
          const Icon = item.icon;
          const pinned = item.href === HOME_HREF;
          return (
            <li key={item.href} className="flex items-center gap-2 border-b border-[var(--color-line)] px-2 py-1.5 last:border-b-0">
              <span className="num w-5 text-center text-xs text-[var(--color-ink-3)]">{i + 1}</span>
              <Icon className="h-4 w-4 shrink-0 text-[var(--color-accent)]" strokeWidth={1.75} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
              {pinned ? (
                <span className="inline-flex items-center gap-1 pr-2 text-[11px] text-[var(--color-ink-3)]">
                  <Lock className="h-3 w-3" aria-hidden="true" /> Always first
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={i <= 1}
                    onClick={() => toFirst(i)}
                    className={cx(iconBtn, 'w-auto px-2 text-[11px] font-medium')}
                    aria-label={`Move ${item.label} to just after Today`}
                  >
                    First
                  </button>
                  <button type="button" disabled={i <= 1} onClick={() => move(i, -1)} className={iconBtn} aria-label={`Move ${item.label} left`}>
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" disabled={i === tabs.length - 1} onClick={() => move(i, 1)} className={iconBtn} aria-label={`Move ${item.label} right`}>
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={tabs.length <= MIN_TABS}
                    onClick={() => save(tabs.filter((t) => t.href !== item.href))}
                    className={cx(iconBtn, 'text-[var(--color-neg)]')}
                    aria-label={`Take ${item.label} out of the tab bar`}
                  >
                    <Minus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mb-2 mt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
        Under More
      </div>
      <ul className="rounded-[var(--radius-field)] border border-[var(--color-line)]">
        {rest.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex items-center gap-2 border-b border-[var(--color-line)] px-2 py-1.5 last:border-b-0">
              <span className="w-5" />
              <Icon className="h-4 w-4 shrink-0 text-[var(--color-ink-3)]" strokeWidth={1.75} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-ink-2)]">{item.label}</span>
              <button
                type="button"
                disabled={full}
                onClick={() => save([...tabs, item])}
                className={cx(iconBtn, 'text-[var(--color-accent)]')}
                aria-label={`Add ${item.label} to the tab bar`}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {full ? (
        <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
          The bar is full — take one out to add another.
        </p>
      ) : null}
      <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
        More always lists your recently opened and most used pages at the top.
      </p>
    </div>
  );
}
