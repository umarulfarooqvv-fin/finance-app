'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, isActive, type NavItem } from '@/lib/nav-sections';
import { cx } from '@/components/ui/primitives';

/* ===========================================================================
   Navigation, in two shapes for two body positions.

   Phone: a bottom tab bar, because that is where the thumb is. It sits above
   the home indicator via the safe-area inset and stays fixed, so moving
   between destinations never costs a scroll to the top.

   Desktop: the same six destinations as a left rail.
   =========================================================================== */

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function Tab({ item, active, variant }: { item: NavItem; active: boolean; variant: 'bar' | 'rail' }) {
  if (variant === 'bar') {
    return (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition-colors',
          active ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-3)] active:bg-[var(--color-raised)]',
        )}
      >
        <Icon path={item.icon} className="h-5 w-5" />
        <span className="text-[10px] font-medium leading-none">{item.label}</span>
      </Link>
    );
  }

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
      <Icon path={item.icon} className="h-[18px] w-[18px]" />
      {item.label}
    </Link>
  );
}

/** Routes that render without app chrome. The lock screen must show nothing
    of the app behind it — not even the shape of the navigation. */
const BARE_ROUTES = ['/lock'];
const isBare = (pathname: string) => BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

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
        {NAV_ITEMS.map((item) => (
          <Tab key={item.href} item={item} active={isActive(pathname, item)} variant="bar" />
        ))}
      </div>
    </nav>
  );
}

export function SideRail() {
  const pathname = usePathname();
  if (isBare(pathname)) return null;
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r border-[var(--color-line)] bg-[var(--color-surface)] p-3 lg:flex"
    >
      <Link href="/" className="mb-4 flex items-center gap-2 px-3 py-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-accent)] text-sm font-bold text-[var(--color-accent-ink)]">
          ₹
        </span>
        <span className="text-sm font-semibold tracking-tight">Finance</span>
      </Link>

      {NAV_ITEMS.map((item) => (
        <Tab key={item.href} item={item} active={isActive(pathname, item)} variant="rail" />
      ))}

      <div className="mt-auto flex flex-col gap-1">
        <Link
          href="/search"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
        >
          <Icon path="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" className="h-[18px] w-[18px]" />
          Search
        </Link>
        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
        >
          <Icon
            path="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
            className="h-[18px] w-[18px]"
          />
          Settings
        </Link>
      </div>
    </nav>
  );
}
