import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle.tsx';

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
    <header className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[var(--color-ink-2)]">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        {showTheme ? <ThemeToggle /> : null}
      </div>
    </header>
  );
}

/** Standard page container. One place controls page width and gutters. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-8">{children}</div>;
}
