import Link from 'next/link';
import { getSnapshot } from '@/lib/snapshot';
import { tally, tallyAccounts } from '@/lib/tally';
import { periodHref, readPeriod, type RawParams } from '@/lib/period';
import { dayOf, formatDay, monthKey } from '@/lib/time';
import { Page, PageHeader } from '@/components/layout/page-header';
import { Money, Panel, SectionTitle, Stat, StatGrid, cx } from '@/components/ui/primitives';
import { PeriodPicker } from '../spending/period-picker';
import { StatementList } from './statement-list';

export const dynamic = 'force-dynamic';

/* ===========================================================================
   Tally — what came in, what went out, and whether it adds up.

   A cash statement, date-wise, so a period can be checked against what the
   bank actually shows. Money charged to a credit card is not here: no cash
   moved when the charge was made, and it leaves on the day the bill is paid.
   It is reported beside the statement so it is visible without being counted
   into a balance it does not affect.
   =========================================================================== */

export default async function TallyPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const sp = await searchParams;
  const snap = await getSnapshot();
  const today = dayOf(snap.loadedAt);

  const dated = snap.transactions.filter((t) => t.ts);
  const earliest = dated.reduce<string>((a, t) => (a === '' || t.ts! < a ? t.ts! : a), '').slice(0, 10);
  const period = readPeriod(sp, today, earliest || today);

  const accounts = tallyAccounts(snap);
  const requested = typeof sp['acct'] === 'string' ? sp['acct'] : '';
  const account = accounts.includes(requested) ? requested : null;

  const t = tally(snap, period.from, period.to, account);

  const months = [...new Set(dated.map((x) => monthKey(x.ts!)))].sort().reverse();
  const years = [...new Set(months.map((m) => m.slice(0, 4)))].sort().reverse();

  const current: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v) current[k] = v;
  const scopeHref = (acct: string | undefined) => periodHref('/tally', { ...current, acct });

  return (
    <Page>
      <PageHeader
        title="Tally"
        subtitle={`${account ?? 'All accounts'} · ${formatDay(period.from)} to ${formatDay(period.to)}`}
      />

      <Panel className="mb-4">
        <PeriodPicker
          period={period}
          months={months}
          years={years}
          base="/tally"
          extra={account ? { acct: account } : undefined}
        />

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)] pt-3">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
            Account
          </span>
          <Link href={scopeHref(undefined)} className={chip(account === null)}>
            All accounts
          </Link>
          {accounts.map((a) => (
            <Link key={a} href={scopeHref(a)} className={chip(account === a)}>
              {a}
            </Link>
          ))}
        </div>
      </Panel>

      <Panel>
        <StatGrid cols={4}>
          <Stat label="Opening balance" value={t.opening} tone="muted" />
          <Stat label="In" value={t.totalIn} tone="credit" />
          <Stat label="Out" value={t.totalOut} tone="debt" />
          <Stat label="Closing balance" value={t.closing} />
        </StatGrid>

        {/* The identity, written out. It holds by construction; stating it is
            what makes this a check rather than one more summary. */}
        <p className="mt-4 border-t border-[var(--color-line)] pt-4 text-xs text-[var(--color-ink-2)]">
          {t.drift === 0 ? (
            'Opening plus in, less out, equals the closing balance — the statement below adds up exactly.'
          ) : (
            <span className="text-[var(--color-neg)]">
              These figures do not reconcile. Treat every number on this page as unreliable until
              that is resolved.
            </span>
          )}
        </p>

        {t.cardSpend > 0 ? (
          <p className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-[var(--color-ink-3)]">
            A further
            <Money value={t.cardSpend} size="sm" tone="muted" />
            was charged to credit cards in this period. No cash left an account, so it is not in the
            figures above — it appears here on the day its bill is paid.
          </p>
        ) : null}
      </Panel>

      <Panel className="mt-4" padded={false}>
        <div className="p-4 sm:p-5">
          <SectionTitle>Day by day</SectionTitle>
          <StatementList days={t.days} opening={t.opening} from={period.from} />
        </div>
      </Panel>
    </Page>
  );
}

function chip(active: boolean): string {
  return cx(
    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
    active
      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
      : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)]',
  );
}
