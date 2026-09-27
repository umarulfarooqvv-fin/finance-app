'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Money, Panel, SectionTitle, cx } from '@/components/ui/primitives';
import type { BillCheck, BillFinding } from '@/lib/bill-check';

/* The whole bill, bank against app — see lib/bill-check for why four numbers.
   Shown at the top of the results whenever the paste carried the statement's
   summary box, because it answers the question a person arrives with ("why
   is the bill different?") before the line-by-line detail does. */
export function BillCheckPanel({
  check, card, previous, onRecord, recording, recorded,
}: {
  check: BillCheck;
  card: string;
  /** The statement before this one, where an inherited difference began. */
  previous: { href: string; label: string } | null;
  onRecord: () => void;
  recording: boolean;
  recorded: boolean;
}) {
  const rows: { label: string; key: keyof BillCheck['bank']; hint: string }[] = [
    { label: 'Opening', key: 'opening', hint: 'previous balance' },
    { label: 'Charges', key: 'charges', hint: 'purchases' },
    { label: 'Payments & refunds', key: 'payments', hint: 'credits' },
    { label: 'The bill', key: 'closing', hint: 'total due' },
  ];
  const off = (n: number) => Math.abs(n) >= 0.005;

  return (
    <Panel className="mb-4">
      <SectionTitle>The whole bill &middot; bank against app</SectionTitle>

      <div className="overflow-hidden rounded-[var(--radius-field)] border border-[var(--color-line)]">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 bg-[var(--color-canvas)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)] sm:gap-x-6">
          <span />
          <span className="text-right">Bank</span>
          <span className="text-right">App</span>
          <span className="text-right">Difference</span>
        </div>
        {rows.map((r) => {
          const d = check.diff[r.key];
          return (
            <div
              key={r.key}
              className={cx(
                'grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-t border-[var(--color-line)] px-3 py-2 text-xs sm:gap-x-6',
                r.key === 'closing' && 'font-semibold',
              )}
            >
              <span className="min-w-0">
                {r.label}
                <span className="ml-1 hidden text-[10px] font-normal text-[var(--color-ink-3)] sm:inline">{r.hint}</span>
              </span>
              <span className="text-right"><Money value={check.bank[r.key]} size="sm" /></span>
              <span className="text-right"><Money value={check.app[r.key]} size="sm" /></span>
              <span className={cx('text-right', off(d) ? 'text-[var(--color-warn)]' : 'text-[var(--color-pos)]')}>
                {off(d) ? <Money value={d} size="sm" /> : <span className="text-[11px]">agrees</span>}
              </span>
            </div>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {check.findings.map((f, i) => (
          <li key={i} className="flex gap-2 text-xs text-[var(--color-ink-2)]">
            {f.kind === 'agree'
              ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--color-pos)]" aria-hidden="true" />
              : <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />}
            <span className="min-w-0"><Finding f={f} card={card} previous={previous} /></span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3">
        <span className="min-w-0 flex-1 text-[11px] text-[var(--color-ink-3)]">
          Recording these keeps this month in {card}&rsquo;s statement history, where every recorded
          month is checked against the bank the same way.
        </span>
        <Button size="sm" variant={recorded ? 'secondary' : 'primary'} pending={recording} onClick={onRecord}>
          {recorded ? 'Recorded' : 'Record the bank’s figures'}
        </Button>
      </div>
    </Panel>
  );
}

function Finding({
  f, card, previous,
}: {
  f: BillFinding;
  card: string;
  previous: { href: string; label: string } | null;
}) {
  const amt = (n: number) => <Money value={Math.abs(n)} size="sm" />;

  switch (f.kind) {
    case 'agree':
      return <>Everything agrees — the opening, every charge, every payment and the bill.</>;

    case 'opening':
      return (
        <>
          <strong className="font-medium text-[var(--color-ink)]">Carried in from before:</strong>{' '}
          the app starts this statement {amt(f.diff)} {f.diff < 0 ? 'lower' : 'higher'} than the bank.
          Nothing on this statement can explain that — it went wrong on an earlier one, and it will
          keep riding along on every bill until that month is fixed.{' '}
          {previous ? (
            <Link href={previous.href} className="inline-flex items-center gap-0.5 font-medium text-[var(--color-accent)]">
              Check the {previous.label} statement <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          ) : null}
        </>
      );

    case 'charges':
      return (
        <>
          <strong className="font-medium text-[var(--color-ink)]">Charges:</strong>{' '}
          {f.diff < 0
            ? <>the statement has {amt(f.diff)} more than the app — a charge with no entry on {card}.</>
            : <>the app has {amt(f.diff)} more than the statement — an entry on {card} the bank never charged.</>}{' '}
          The unmatched lines below are the ones to look at.
        </>
      );

    case 'payments':
      return (
        <>
          <strong className="font-medium text-[var(--color-ink)]">Payments &amp; refunds:</strong>{' '}
          {f.diff < 0
            ? <>the statement credits {amt(f.diff)} more than the app has — a payment or refund with no entry.
                A fuel-surcharge waiver or a merchant refund is the usual one.</>
            : <>the app has {amt(f.diff)} more paid than the statement shows — a payment recorded here the bank
                never received, or recorded twice.</>}
        </>
      );

    case 'bank-extra':
      return (
        <>
          <strong className="font-medium text-[var(--color-ink)]">The bank&rsquo;s own figures</strong>{' '}
          do not add up by {amt(f.amount)} — usually a fee or interest the statement charged outside its list of
          transactions.
        </>
      );
  }
}
