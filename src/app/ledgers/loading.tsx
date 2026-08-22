import { PageSkeleton, StatRowSkeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Shown while this route's data resolves. Mirrors the real layout so nothing
    jumps when it lands. */
export default function Loading() {
  return (
    <PageSkeleton>
      <StatRowSkeleton cols={3} />
      <TableSkeleton rows={6} />
      <TableSkeleton rows={3} />
    </PageSkeleton>
  );
}
