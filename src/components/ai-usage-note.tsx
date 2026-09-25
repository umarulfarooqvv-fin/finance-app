import { AlertTriangle, Gauge } from 'lucide-react';
import type { UsageLine } from '@/lib/ai/usage';
import { cn } from '@/lib/cn';

/* How much of the AI provider's allowance is left, in one line.

   Quiet while there is plenty — a gauge nobody needs to read should not shout.
   Amber when under a tenth is left, and a full-width notice once the limit is
   reached, because that is the moment photos stop being read and a person
   needs to know it is the quota, not the app. */
export function AiUsageNote({ usage }: { usage: UsageLine | null }) {
  if (!usage) return null;

  if (usage.tone === 'limited') {
    return (
      <p
        role="status"
        className="flex w-full items-start gap-1.5 rounded-[var(--radius-field)] border border-[var(--color-warn)] px-2.5 py-1.5 text-[11px] text-[var(--color-warn)]"
      >
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {usage.text}
      </p>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px]',
        usage.tone === 'low' ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink-3)]',
      )}
    >
      <Gauge className="h-3 w-3" aria-hidden="true" />
      {usage.text}
    </span>
  );
}
