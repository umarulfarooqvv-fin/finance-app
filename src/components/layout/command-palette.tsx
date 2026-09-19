'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { CornerDownLeft, Search } from 'lucide-react';
import { NAV_SECTIONS } from '@/lib/nav-sections';

/* ===========================================================================
   ⌘K palette — the third surface rendering from lib/nav-sections.ts.

   cmdk does the filtering and keyboard handling; the point here is that the
   destination list is not duplicated. A new entry in nav-sections appears in
   the sidebar, the tab bar and this palette at once, matched on its keywords
   as well as its label — so "who owes me" finds Ledgers and "bill" finds
   Cards, which a label-only search would not.
   =========================================================================== */

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

          {NAV_SECTIONS.map((section) => (
            <Command.Group
              key={section.title}
              heading={section.title}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-ink-3)]"
            >
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Command.Item
                    key={item.href}
                    // cmdk matches on this string, so the keywords ride along
                    // with the label rather than being a separate index.
                    value={`${item.label} ${item.hint ?? ''} ${(item.keywords ?? []).join(' ')}`}
                    onSelect={() => go(item.href)}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-[var(--color-accent-soft)] data-[selected=true]:text-[var(--color-accent)]"
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.label}</span>
                      {item.hint ? (
                        <span className="block truncate text-[11px] text-[var(--color-ink-3)]">
                          {item.hint}
                        </span>
                      ) : null}
                    </span>
                    <CornerDownLeft
                      className="h-3 w-3 shrink-0 opacity-0 data-[selected=true]:opacity-60"
                      aria-hidden="true"
                    />
                  </Command.Item>
                );
              })}
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
