'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

/**
 * Theme control with three states, not two.
 *
 * "System" is the default and is a real choice, not the absence of one: with
 * no explicit theme the page follows prefers-color-scheme. Picking light or
 * dark stamps data-theme on <html>, which the stylesheet guards against so an
 * explicit choice always beats the media query.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = document.documentElement.dataset['theme'];
    setTheme(stored === 'light' || stored === 'dark' ? stored : 'system');
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    if (next === 'system') delete document.documentElement.dataset['theme'];
    else document.documentElement.dataset['theme'] = next;
    // A year-long cookie so the server can render the right theme on first
    // paint, avoiding the white flash before hydration.
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  const options: { value: Theme; label: string; icon: string }[] = [
    { value: 'light', label: 'Light', icon: 'M12 3v2m0 14v2m9-9h-2M5 12H3m14.7-6.7l-1.4 1.4M7.7 16.3l-1.4 1.4m12 0l-1.4-1.4M7.7 7.7L6.3 6.3M16 12a4 4 0 11-8 0 4 4 0 018 0z' },
    { value: 'system', label: 'System', icon: 'M4 5h16v10H4zM8 19h8M12 15v4' },
    { value: 'dark', label: 'Dark', icon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => apply(o.value)}
          className={
            theme === o.value
              ? 'grid h-7 w-7 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
              : 'grid h-7 w-7 place-items-center rounded-full text-[var(--color-ink-3)] transition-colors hover:text-[var(--color-ink)]'
          }
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d={o.icon} />
          </svg>
        </button>
      ))}
    </div>
  );
}
