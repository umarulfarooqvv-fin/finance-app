'use client';

import { Eye, EyeOff } from 'lucide-react';
import { usePrivacy } from '@/contexts/privacy-context';

/** Toggle for screen privacy. Sits next to the theme control in the header. */
export function PrivacyToggle() {
  const { hidden, toggle } = usePrivacy();
  const Icon = hidden ? EyeOff : Eye;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      title={hidden ? 'Show amounts (⌘⇧H)' : 'Hide amounts for screen sharing (⌘⇧H)'}
      className={
        hidden
          ? 'grid h-8 w-8 place-items-center rounded-full border border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'grid h-8 w-8 place-items-center rounded-full border border-[var(--color-line)] text-[var(--color-ink-3)] transition-colors hover:text-[var(--color-ink)]'
      }
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">{hidden ? 'Amounts hidden' : 'Amounts visible'}</span>
    </button>
  );
}
