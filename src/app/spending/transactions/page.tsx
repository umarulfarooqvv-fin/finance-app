import Link from 'next/link';
import { getSnapshot } from '@/lib/snapshot';
import { upcomingRows } from '@/lib/analytics';
import { dayOf, endOfDay, formatDayShort } from '@/lib/time';
import { money } from '@/lib/format';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Badge, Empty, Money, Panel, TableWrap, Td, Th } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

/* ===========================================================================
   The full transaction list.

   Pre-logged future rows are hidden by default — an EMI instalment entered
   months ahead is not something you did, and mixing it into the feed makes
   the most recent entry a date that has not happened. ?upcoming=1 shows them.
   =========================================================================== */

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; method?: string; category?: string; upcoming?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);
  const now = endOfDay(today);

  const showUpcoming = sp.upcoming === '1';
  const needle = (sp.q ?? '').toLowerCase().trim();
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const all = snap.transactions.filter((t) => {
    if (t.deleted || !t.ts) return false;
    if (!showUpcoming && t.ts > now) return false;
    if (sp.method && t.method !== sp.method) return false;
    if (sp.category && t.category !== sp.category) return false;
    if (needle && !`${t.remarks} ${t.category} ${t.method}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  const sorted = all.sort((a, b) => (a.ts! < b.ts! ? 1 : -1));
  const rows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const hiddenUpcoming = showUpcoming ? 0 : upcomingRows(snap, today).length;

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <Page>
      <PageHeader
        title="Transactions"
        subtitle={`${sorted.length.toLocaleString('en-IN')} ${sorted.length === 1 ? 'entry' : 'entries'}`}
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
          <button
            type="submit"
            className="rounded-[var(--radius-field)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)]"
          >
            Search
          </button>
        </form>

        {hiddenUpcoming > 0 || showUpcoming ? (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-3)]">
            {showUpcoming
              ? 'Including rows dated in the future.'
              : `${hiddenUpcoming} pre-logged future ${hiddenUpcoming === 1 ? 'row is' : 'rows are'} hidden — they appear on their date.`}
            <Link
              href={qs({ upcoming: showUpcoming ? undefined : '1', page: undefined })}
              className="font-medium text-[var(--color-accent)]"
            >
              {showUpcoming ? 'Hide them' : 'Show them'}
            </Link>
          </p>
        ) : null}
      </Panel>

      <Panel padded={false}>
        <div className="p-4 sm:p-5">
          {rows.length === 0 ? (
            <Empty title="Nothing matches" hint="Try a different search." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Description</Th>
                  <Th>Category</Th>
                  <Th>Method</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <Td className="whitespace-nowrap text-xs text-[var(--color-ink-2)]">
                      {formatDayShort(t.ts!.slice(0, 10))}
                    </Td>
                    <Td>
                      <span className="flex items-center gap-2">
                        <span className="truncate">{t.remarks || t.category}</span>
                        {t.ts! > now ? <Badge tone="neutral">upcoming</Badge> : null}
                        {t.kind === 'card_payment' ? <Badge tone="good">bill paid</Badge> : null}
                        {t.kind === 'credit_given' ? <Badge tone="accent">lent</Badge> : null}
                        {t.verified ? (
                          <span className="text-[var(--color-pos)]" title="Verified">✓</span>
                        ) : null}
                      </span>
                    </Td>
                    <Td className="text-xs text-[var(--color-ink-3)]">{t.category}</Td>
                    <Td className="text-xs text-[var(--color-ink-3)]">{t.method}</Td>
                    <Td align="right">
                      <Money
                        value={t.amount}
                        size="sm"
                        tone={t.kind === 'card_payment' ? 'credit' : 'neutral'}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      </Panel>

      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-xs">
          {page > 1 ? (
            <Link href={qs({ page: String(page - 1) })} className="font-medium text-[var(--color-accent)]">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[var(--color-ink-3)]">
            Page {page} of {pages} · {money(sorted.reduce((a, t) => a + (t.amount ?? 0), 0))} total
          </span>
          {page < pages ? (
            <Link href={qs({ page: String(page + 1) })} className="font-medium text-[var(--color-accent)]">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </Page>
  );
}
