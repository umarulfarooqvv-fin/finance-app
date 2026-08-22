import { cx } from '@/components/ui/primitives';

/* ===========================================================================
   Skeletons for loading.tsx.

   The point is not decoration: a skeleton that matches the real layout means
   navigation feels instant and nothing jumps when the data lands. Each shape
   here mirrors the panel it stands in for.
   =========================================================================== */

export function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={cx('animate-pulse rounded-md bg-[var(--color-raised)]', className)}
      aria-hidden="true"
    />
  );
}

export function PanelSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 sm:p-5">
      <Shimmer className="h-3 w-28" />
      <Shimmer className="mt-3 h-8 w-48" />
      <div className="mt-4 flex flex-col gap-2">
        {Array.from({ length: lines }, (_, i) => (
          <Shimmer key={i} className="h-3" />
        ))}
      </div>
    </div>
  );
}

export function StatRowSkeleton({ cols = 4 }: { cols?: number }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: cols }, (_, i) => (
          <div key={i}>
            <Shimmer className="h-2.5 w-20" />
            <Shimmer className="mt-2 h-6 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 sm:p-5">
      <Shimmer className="h-3 w-24" />
      <div className="mt-4 flex flex-col gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Shimmer className="h-3 w-24 shrink-0" />
            <Shimmer className="h-3 flex-1" />
            <Shimmer className="h-3 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The page frame every loading.tsx reuses, so the header never shifts. */
export function PageSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-5">
        <Shimmer className="h-7 w-40" />
        <Shimmer className="mt-2 h-3 w-64" />
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}
