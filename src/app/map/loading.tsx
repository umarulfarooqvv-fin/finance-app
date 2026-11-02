import { PageSkeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageSkeleton>
      <TableSkeleton rows={12} />
    </PageSkeleton>
  );
}
