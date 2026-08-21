import type { ReactNode } from 'react';
import { money } from './format.ts';

/* ===========================================================================
   The shared vocabulary.

   v2 had three components and twenty-two pages, so every page improvised its
   own spacing, borders and type scale with inline styles. Everything visual in
   v3 is assembled from the pieces below, which is what makes the screens look
   like one product instead of twenty-two.
   =========================================================================== */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* --- Surfaces ------------------------------------------------------------ */

export function Panel({
  children, className, as: Tag = 'section', padded = true,
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
  padded?: boolean;
}) {
  return (
    <Tag
      className={cx(
        'rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]',
        padded && 'p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title, subtitle, action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-[var(--color-ink)]">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* --- Money --------------------------------------------------------------- */

export type MoneyTone = 'auto' | 'neutral' | 'debt' | 'credit' | 'muted';

/**
 * The single way a rupee figure reaches the screen.
 *
 * `tone="auto"` colours by sign, which is right for a change or a net figure
 * but WRONG for a bill: an amount you owe is not "bad news in red" just
 * because it is positive. Callers state which they mean, so the default never
 * quietly editorialises.
 */
export function Money({
  value, tone = 'neutral', size = 'md', whole = false, className,
}: {
  value: number | null | undefined;
  tone?: MoneyTone;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'display';
  whole?: boolean;
  className?: string;
}) {
  const sizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-lg font-semibold tracking-tight',
    xl: 'text-2xl font-semibold tracking-tight',
    display: 'text-3xl sm:text-4xl font-semibold tracking-tight',
  } as const;

  let color = 'text-[var(--color-ink)]';
  if (tone === 'muted') color = 'text-[var(--color-ink-3)]';
  else if (tone === 'debt') color = 'text-[var(--color-neg)]';
  else if (tone === 'credit') color = 'text-[var(--color-pos)]';
  else if (tone === 'auto' && typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0) color = 'text-[var(--color-pos)]';
    else if (value < 0) color = 'text-[var(--color-neg)]';
  }

  return <span className={cx('num', sizes[size], color, className)}>{money(value, { whole })}</span>;
}

/* --- Stat tile ----------------------------------------------------------- */

export function Stat({
  label, value, hint, tone = 'neutral', emphasis = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: MoneyTone;
  emphasis?: boolean;
}) {
  return (
    <div className={cx('min-w-0', emphasis && 'sm:col-span-2')}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
        {label}
      </div>
      <div className="mt-1">
        {typeof value === 'number' ? (
          <Money value={value} tone={tone} size={emphasis ? 'display' : 'lg'} />
        ) : (
          <span className={cx('num', emphasis ? 'text-3xl' : 'text-lg', 'font-semibold tracking-tight')}>
            {value}
          </span>
        )}
      </div>
      {hint ? <div className="mt-1 text-xs text-[var(--color-ink-3)]">{hint}</div> : null}
    </div>
  );
}

export function StatGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const grid = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols];
  return <div className={cx('grid grid-cols-2 gap-4', grid)}>{children}</div>;
}

/* --- Badge --------------------------------------------------------------- */

export type BadgeTone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

export function Badge({
  children, tone = 'neutral', className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-[var(--color-raised)] text-[var(--color-ink-2)] border-[var(--color-line)]',
    good: 'bg-[var(--color-pos-soft)] text-[var(--color-pos)] border-transparent',
    warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)] border-transparent',
    bad: 'bg-[var(--color-neg-soft)] text-[var(--color-neg)] border-transparent',
    accent: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-transparent',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* --- Utilization meter ---------------------------------------------------
   Colour steps at 30/60/85% of the limit. The bar is never rendered without a
   real limit behind it — a meter with an unknown denominator is decoration
   pretending to be information. */

export function Meter({ value, label }: { value: number | null; label?: string }) {
  if (value === null || !Number.isFinite(value)) {
    return <div className="text-xs text-[var(--color-ink-3)]">No limit set</div>;
  }
  const pct = Math.max(0, Math.min(1, value));
  const color =
    value >= 0.85 ? 'var(--color-neg)' : value >= 0.6 ? 'var(--color-warn)' : value >= 0.3 ? 'var(--color-accent)' : 'var(--color-pos)';

  return (
    <div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-raised)]"
        role="meter"
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Credit utilisation'}
      >
        <div className="h-full rounded-full transition-[width]" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
    </div>
  );
}

/* --- Empty state ---------------------------------------------------------
   Every list gets one. "Nothing here" plus a reason beats a blank rectangle. */

export function Empty({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="text-2xl opacity-60">{icon}</div> : null}
      <p className="text-sm font-medium text-[var(--color-ink-2)]">{title}</p>
      {hint ? <p className="max-w-xs text-xs text-[var(--color-ink-3)]">{hint}</p> : null}
    </div>
  );
}

/* --- Section heading ----------------------------------------------------- */

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        {children}
      </h2>
      {action}
    </div>
  );
}

/* --- Table ---------------------------------------------------------------
   Wide tables scroll inside their own container so the page body never
   scrolls sideways on a phone. */

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[560px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, align = 'left' }: { children?: ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      className={cx(
        'border-b border-[var(--color-line)] px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
      )}
      scope="col"
    >
      {children}
    </th>
  );
}

export function Td({
  children, align = 'left', className, colSpan,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cx(
        'border-b border-[var(--color-line)] px-3 py-2.5 align-middle',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

/* --- Card colour dot ----------------------------------------------------- */

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: color }}
    />
  );
}
