import { PageSkeleton, StatRowSkeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageSkeleton>
      <StatRowSkeleton cols={3} />
      <TableSkeleton rows={8} />
    </PageSkeleton>
  );
}
