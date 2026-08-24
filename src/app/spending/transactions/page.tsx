import Link from 'next/link';
import { currentSnapshot } from '@/lib/views';
import { upcomingRows } from '@/lib/analytics';
import { endOfDay, formatDay, nowIST } from '@/lib/time';
import { money } from '@/lib/format';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Panel } from '@/components/ui/primitives';
import { TransactionsClient, type Row } from './transactions-client';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

/* ===========================================================================
   Guard, fetch, strip, render — then hand plain data to the client island.

   "Strip" matters even in a single-user app: whatever this passes down ships
   in the RSC payload and is readable in the browser. So the client gets the
   fields the table needs and nothing else — no internal ids beyond the row
   key, no source, no tag blobs.
   =========================================================================== */

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; upcoming?: string; deleted?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const { snap, today } = await currentSnapshot();
  const now = endOfDay(today);

  const showUpcoming = sp.upcoming === '1';
  const showDeleted = sp.deleted === '1';
  const needle = (sp.q ?? '').toLowerCase().trim();
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const matched = snap.transactions.filter((t) => {
    if (!t.ts) return false;
    if (t.deleted !== showDeleted) return false;
    if (!showUpcoming && t.ts > now) return false;
    if (needle && !`${t.remarks} ${t.category} ${t.method}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  const sorted = matched.sort((a, b) => (a.ts! < b.ts! ? 1 : -1));
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const hiddenUpcoming = showUpcoming ? 0 : upcomingRows(snap, today).length;

  const rows: Row[] = pageRows.map((t) => ({
    id: t.id,
    ts: t.ts!,
    amount: t.amount ?? 0,
    method: t.method,
    category: t.category,
    remarks: t.remarks,
    kind: t.kind,
    verified: t.verified,
    deleted: t.deleted,
    isFuture: t.ts! > now,
  }));

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <Page>
      <PageHeader
        title="Transactions"
        subtitle={`${sorted.length.toLocaleString('en-IN')} ${sorted.length === 1 ? 'entry' : 'entries'}${showDeleted ? ' · deleted' : ''}`}
        action={
          <Link
            href="/spending"
            className="rounded-[var(--radius-field)] border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-line-strong)]"
          >
            Back
          </Link>
        }
      />

      <Panel className="mb-4">
        <form className="flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Search remarks, category or method"
            aria-label="Search transactions"
            className="min-w-0 flex-1 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          {showUpcoming ? <input type="hidden" name="upcoming" value="1" /> : null}
          {showDeleted ? <input type="hidden" name="deleted" value="1" /> : null}
          <button
            type="submit"
            className="rounded-[var(--radius-field)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)]"
          >
            Search
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-ink-3)]">
          {hiddenUpcoming > 0 || showUpcoming ? (
            <span className="flex items-center gap-2">
              {showUpcoming
                ? 'Including rows dated in the future.'
                : `${hiddenUpcoming} pre-logged future ${hiddenUpcoming === 1 ? 'row is' : 'rows are'} hidden.`}
              <Link href={qs({ upcoming: showUpcoming ? undefined : '1', page: undefined })} className="font-medium text-[var(--color-accent)]">
                {showUpcoming ? 'Hide' : 'Show'}
              </Link>
            </span>
          ) : null}
          <Link href={qs({ deleted: showDeleted ? undefined : '1', page: undefined })} className="font-medium text-[var(--color-accent)]">
            {showDeleted ? 'Back to active entries' : 'View deleted'}
          </Link>
        </div>
      </Panel>

      <Panel padded={false}>
        <div className="p-4 sm:p-5">
          <TransactionsClient rows={rows} defaultTs={nowIST()} nowIso={now} />
        </div>
      </Panel>

      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-xs">
          {page > 1 ? (
            <Link href={qs({ page: String(page - 1) })} className="font-medium text-[var(--color-accent)]">← Newer</Link>
          ) : <span />}
          <span className="text-[var(--color-ink-3)]">
            Page {page} of {pages} ·{' '}
            <span className="sensitive">
              {money(sorted.reduce((a, t) => a + (t.amount ?? 0), 0))}
            </span>{' '}
            total
          </span>
          {page < pages ? (
            <Link href={qs({ page: String(page + 1) })} className="font-medium text-[var(--color-accent)]">Older →</Link>
          ) : <span />}
        </div>
      ) : null}

      <p className="mt-4 text-center text-[11px] text-[var(--color-ink-3)]">
        As of {formatDay(today)}
      </p>
    </Page>
  );
}
