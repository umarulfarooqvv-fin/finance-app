'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';

/* ===========================================================================
   Reload this page's data without a full browser reload.

   Sits next to the privacy and theme toggles for the same reason they do:
   every page already calls router.refresh() after a write to see the result
   immediately, so this is that same call with nothing to write first — for
   the moment something changed elsewhere (another device, the Sheet sync, a
   cron job) and the page hasn't heard about it yet.
   =========================================================================== */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      aria-label="Refresh this page"
      aria-busy={pending || undefined}
      title="Refresh"
      className="grid h-8 w-8 place-items-center rounded-full border border-[var(--color-line)] text-[var(--color-ink-3)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
    >
      <RotateCw
        className={pending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </button>
  );
}
