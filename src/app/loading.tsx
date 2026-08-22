import { PageSkeleton, PanelSkeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Shown while this route's data resolves. Mirrors the real layout so nothing
    jumps when it lands. */
export default function Loading() {
  return (
    <PageSkeleton>
      <PanelSkeleton lines={2} />
      <TableSkeleton rows={3} />
      <TableSkeleton rows={4} />
    </PageSkeleton>
  );
}
