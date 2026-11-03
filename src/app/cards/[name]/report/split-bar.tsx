import { Money } from '@/components/ui/primitives';

/* One bar cut into the parts of a bill, with its legend underneath.

   The question it answers at a glance is "how much of this was MINE": the
   parts are drawn to scale against the whole, so a bill that is mostly lent
   money looks like one. Parts that are zero are left out of both the bar and
   the legend. */

export type SplitPart = { label: string; value: number; color: string; note?: string };

export function SplitBar({ parts, label }: { parts: SplitPart[]; label: string }) {
  const shown = parts.filter((p) => p.value > 0.005);
  const total = shown.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return null;

  return (
    <div>
      <div
        role="img"
        aria-label={label}
        className="flex h-3.5 w-full overflow-hidden rounded-full bg-[var(--color-raised)]"
      >
        {shown.map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={p.label} />
        ))}
      </div>
      <ul className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {shown.map((p) => (
          <li key={p.label} className="flex items-start gap-2 text-xs">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="text-[var(--color-ink-2)]">{p.label}</span>
              {p.note ? <span className="block text-[10px] text-[var(--color-ink-3)]">{p.note}</span> : null}
            </span>
            <span className="text-right">
              <Money value={p.value} size="sm" className="font-semibold" />
              <span className="num block text-[10px] text-[var(--color-ink-3)]">{p.value / total < 0.005 ? '<1' : Math.round((p.value / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
