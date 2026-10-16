import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { PrivacyToggle } from '@/components/layout/privacy-toggle';
import { RefreshButton } from '@/components/layout/refresh-button';
import { CalculatorToggle } from '@/components/calculator/calculator';

/** Consistent page chrome: title, one line of context, and room for actions. */
export function PageHeader({
  title, subtitle, action, showTheme = true,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  showTheme?: boolean;
}) {
  return (
    /* The title row is FROZEN: the calculator, refresh, privacy and theme are
       wanted wherever you have scrolled to. It is one row — title on the left,
       truncating if it must, controls on the right — so the frozen part stays
       as short as a phone can afford. The subtitle scrolls away under it.
       Full-bleed (negative margins match <Page>'s gutters) so rows scrolling
       beneath never show at the edges.

       A fragment, not a wrapper: a sticky element only sticks while its
       PARENT is on screen, so it must be a child of the page itself, not of a
       short <header> that scrolls away and takes the bar with it. */
    <>
      <header className="sticky top-0 z-40 -mx-4 flex h-[var(--app-top)] items-center gap-3 bg-[var(--color-canvas)]/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:-mx-6 sm:px-6">
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {action}
          <CalculatorToggle />
          <RefreshButton />
          <PrivacyToggle />
          {showTheme ? <ThemeToggle /> : null}
        </div>
      </header>
      <div className="mb-5">
        {subtitle ? <p className="text-sm text-[var(--color-ink-2)]">{subtitle}</p> : null}
      </div>
    </>
  );
}

/** Standard page container. One place controls page width and gutters. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl px-4 pb-5 sm:px-6 sm:pb-8">{children}</div>;
}
