import { PageSkeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Shown while this route's data resolves. Mirrors the real layout so nothing
    jumps when it lands. */
export default function Loading() {
  return (
    <PageSkeleton>
      <TableSkeleton rows={6} />
    </PageSkeleton>
  );
}
