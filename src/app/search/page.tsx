import { redirect } from 'next/navigation';

/**
 * Search lives inside the transaction list rather than as a second, parallel
 * search surface with its own conventions. This keeps the nav entry working
 * and lands the user where the results actually are.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  redirect(q ? `/transactions?q=${encodeURIComponent(q)}` : '/transactions');
}
