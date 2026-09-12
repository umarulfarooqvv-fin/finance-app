import { redirect } from 'next/navigation';

/* The list moved to its own top-level route. Anything bookmarked, or linked
   from an older build, lands here and is forwarded with its query intact. */
export default async function MovedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string' && v) qs.set(k, v);
  }
  const query = qs.toString();
  redirect(query ? `/transactions?${query}` : '/transactions');
}
