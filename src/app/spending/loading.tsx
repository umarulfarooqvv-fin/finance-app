import { PageSkeleton, StatRowSkeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Shown while this route's data resolves. Mirrors the real layout so nothing
    jumps when it lands. */
export default function Loading() {
  return (
    <PageSkeleton>
      <StatRowSkeleton />
      <TableSkeleton rows={5} />
      <TableSkeleton rows={4} />
    </PageSkeleton>
  );
}
