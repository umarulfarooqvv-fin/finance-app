'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IndianRupee } from 'lucide-react';
import {
  NAV_SECTIONS, PRIMARY_NAV_ITEMS, isActive, type NavItem,
} from '@/lib/nav-sections';
import { cx } from '@/components/ui/primitives';
import { CommandTrigger } from '@/components/layout/command-palette';

/* ===========================================================================
   Two shapes, one data source (see lib/nav-sections.ts).

   Phone: a bottom tab bar, because that is where the thumb is. It sits above
   the home indicator via the safe-area inset and stays fixed, so moving
   between destinations never costs a scroll to the top.

   Desktop: a left rail with the same destinations, grouped into sections, and
   the command palette trigger pinned at the top.
   =========================================================================== */

/** Routes that render without app chrome. The lock screen must show nothing
    of the app behind it — not even the shape of the navigation. */
const BARE_ROUTES = ['/lock'];
const isBare = (pathname: string) =>
  BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

export function BottomBar() {
  const pathname = usePathname();
  if (isBare(pathname)) return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-line)] bg-[var(--color-surface)]/95 backdrop-blur-lg lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-lg items-stretch gap-0.5 px-2 py-1">
        {PRIMARY_NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition-colors',
                active
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-ink-3)] active:bg-[var(--color-raised)]',
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'text-[var(--color-ink-2)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]',
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
      {item.label}
    </Link>
  );
}

export function SideRail() {
  const pathname = usePathname();
  if (isBare(pathname)) return null;

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--color-line)] bg-[var(--color-surface)] p-3 lg:flex"
    >
      <Link href="/" className="mb-3 flex items-center gap-2 px-3 py-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-ink)]">
          <IndianRupee className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
        </span>
        <span className="text-sm font-semibold tracking-tight">Finance</span>
      </Link>

      <CommandTrigger />

      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className="mt-3 first:mt-1">
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
            {section.title}
          </div>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <RailLink key={item.href} item={item} active={isActive(pathname, item)} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
