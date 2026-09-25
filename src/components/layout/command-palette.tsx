'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { CornerDownLeft, Search } from 'lucide-react';
import { ALL_NAV_ITEMS, NAV_SECTIONS, navItemFor, type NavItem } from '@/lib/nav-sections';
import {
  frequentPages, parseVisits, recentPages, recordVisit, EMPTY_VISITS, type PageVisits,
} from '@/lib/page-history';

/* ===========================================================================
   ⌘K palette — the third surface rendering from lib/nav-sections.ts.

   cmdk does the filtering and keyboard handling; the point here is that the
   destination list is not duplicated. A new entry in nav-sections appears in
   the sidebar, the tab bar and this palette at once, matched on its keywords
   as well as its label — so "who owes me" finds Ledgers and "bill" finds
   Cards, which a label-only search would not.
   =========================================================================== */

const VISITS_KEY = 'pfm:visits';

function readVisits(): PageVisits {
  try { return parseVisits(localStorage.getItem(VISITS_KEY)); } catch { return EMPTY_VISITS; }
}

/**
 * Records each destination opened, for Recent and Frequently used. Mounted
 * once in the root layout rather than in the sidebar or the tab bar, because
 * both of those are always mounted and each would count every visit.
 */
export function VisitTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const item = navItemFor(pathname);
    if (!item) return;
    try {
      localStorage.setItem(VISITS_KEY, JSON.stringify(recordVisit(readVisits(), item.href)));
    } catch { /* private browsing: the palette just shows its ordinary list */ }
  }, [pathname]);
  return null;
}

const GROUP_CLASS =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-ink-3)]';

function PaletteItem({ item, value, onSelect }: { item: NavItem; value: string; onSelect: () => void }) {
  const Icon = item.icon;
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-[var(--color-accent-soft)] data-[selected=true]:text-[var(--color-accent)]"
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.label}</span>
        {item.hint ? (
          <span className="block truncate text-[11px] text-[var(--color-ink-3)]">{item.hint}</span>
        ) : null}
      </span>
      <CornerDownLeft
        className="h-3 w-3 shrink-0 opacity-0 data-[selected=true]:opacity-60"
        aria-hidden="true"
      />
    </Command.Item>
  );
}

const byHref = (href: string) => ALL_NAV_ITEMS.find((i) => i.href === href);

export function CommandPalette({
  open, onOpenChange, autoFocusInput = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Off for the phone tab bar's More button. Autofocusing pops the virtual
   * keyboard, which on a phone eats most of the screen before the fourteen
   * grouped destinations are even visible — exactly backwards for a button
   * whose job is "let me reach a page", not "let me type a query". Desktop
   * keeps the default: a hand is already on the keyboard when ⌘K or the
   * sidebar's Search button is used, so focusing it immediately is the point.
   */
  autoFocusInput?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState('');

  /* Recent and frequent, read fresh each time the palette opens, and read
     DURING the render that opens it rather than after. cmdk highlights the
     first item it sees; lists that arrive a moment later leave the highlight
     on Today, and Enter then goes nowhere useful. The palette only renders on
     the client, after a tap or ⌘K, so localStorage is there to read. */
  const shortcuts = useMemo(() => {
    const none = { recent: [] as NavItem[], frequent: [] as NavItem[] };
    if (!open || typeof window === 'undefined') return none;
    const visits = readVisits();
    const current = navItemFor(pathname)?.href ?? null;
    const recent = recentPages(visits, current, 3);
    const frequent = frequentPages(visits, [current, ...recent], 4);
    return {
      recent: recent.map(byHref).filter((i): i is NavItem => Boolean(i)),
      frequent: frequent.map(byHref).filter((i): i is NavItem => Boolean(i)),
    };
  }, [open, pathname]);

  // Cleared on closing, so the next opening starts with the shortcuts showing
  // rather than the last search.
  useEffect(() => { if (!open) setSearch(''); }, [open]);

  // Navigate BEFORE closing. Closing first unmounts this subtree in the same
  // React commit, and the push that follows never lands — the palette shuts
  // and you stay on the page you were already looking at.
  const go = (href: string) => {
    router.push(href);
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      role="presentation"
      onClick={() => onOpenChange(false)}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-hidden="true" />

      <Command
        label="Command palette"
        loop
        className="relative w-full max-w-lg overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3">
          <Search className="h-4 w-4 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            autoFocus={autoFocusInput}
            placeholder="Go to… or search"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-[var(--color-ink-3)]"
          />
          <kbd className="hidden shrink-0 rounded border border-[var(--color-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-ink-3)] sm:block">
            esc
          </kbd>
        </div>

        <Command.List className="max-h-[min(24rem,60vh)] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-8 text-center text-sm text-[var(--color-ink-3)]">
            Nothing matches that.
          </Command.Empty>

          {/* Only on an empty search: once something is typed, the ordinary
              list filtered by it is the answer, and a page appearing twice
              would be noise. Values are prefixed so cmdk keeps them apart
              from the same page further down. */}
          {search.trim() === '' && shortcuts.recent.length > 0 ? (
            <Command.Group heading="Recent" className={GROUP_CLASS}>
              {shortcuts.recent.map((item) => (
                <PaletteItem key={`recent-${item.href}`} item={item} value={`recent:${item.href}`} onSelect={() => go(item.href)} />
              ))}
            </Command.Group>
          ) : null}
          {search.trim() === '' && shortcuts.frequent.length > 0 ? (
            <Command.Group heading="Frequently used" className={GROUP_CLASS}>
              {shortcuts.frequent.map((item) => (
                <PaletteItem key={`frequent-${item.href}`} item={item} value={`frequent:${item.href}`} onSelect={() => go(item.href)} />
              ))}
            </Command.Group>
          ) : null}

          {NAV_SECTIONS.map((section) => (
            <Command.Group key={section.title} heading={section.title} className={GROUP_CLASS}>
              {section.items.map((item) => (
                <PaletteItem
                  key={item.href}
                  item={item}
                  // cmdk matches on this string, so the keywords ride along
                  // with the label rather than being a separate index.
                  value={`${item.label} ${item.hint ?? ''} ${(item.keywords ?? []).join(' ')}`}
                  onSelect={() => go(item.href)}
                />
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}

/** Global ⌘K / Ctrl+K listener plus the sidebar button that opens it. */
export function CommandTrigger() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm text-[var(--color-ink-3)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink-2)]"
      >
        <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded border border-[var(--color-line)] px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </button>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}
