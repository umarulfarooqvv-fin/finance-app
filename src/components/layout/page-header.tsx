import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { PrivacyToggle } from '@/components/layout/privacy-toggle';
import { RefreshButton } from '@/components/layout/refresh-button';

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
    /* Wraps rather than squeezes. The actions are shrink-0, so on a narrow
       screen a page with a real button in its header — not just an icon — used
       to crush the title to nothing and spill the buttons over it. Given a
       floor of its own, the title keeps its line and the actions drop below. */
    <header className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-48">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[var(--color-ink-2)]">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        <RefreshButton />
        <PrivacyToggle />
        {showTheme ? <ThemeToggle /> : null}
      </div>
    </header>
  );
}

/** Standard page container. One place controls page width and gutters. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-8">{children}</div>;
}
