'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, CircleAlert, HelpCircle } from 'lucide-react';
import type { CycleReconciliation } from '@/lib/reconcile';
import type { StatementBoundary } from '@/lib/types';
import { formatDay } from '@/lib/time';
import { money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, inputClass } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Badge, Money, SectionTitle } from '@/components/ui/primitives';
import { recordStatementAction, setBoundaryAction } from './actions';

/* ===========================================================================
   Reconciling a statement against the bank.

   The question this answers — "did the bill date's own spending land on this
   statement or the next one?" — is not one a person can answer from memory.
   But they can read the closing balance off the statement, and that single
   number settles it.

   So the UI asks for the figure, not for the rule.
   =========================================================================== */

export type Props = {
  card: string;
  /** Recent statement dates, newest first. */
  statementDates: string[];
  /** Reconciliations for statements whose figure has already been recorded. */
  recorded: CycleReconciliation[];
};

function Verdict({ r, onPin, pending }: {
  r: CycleReconciliation;
  onPin: (boundary: StatementBoundary) => void;
  pending: boolean;
}) {
  if (r.verdict.kind === 'indifferent') {
    return (
      <p className="flex items-start gap-2 text-xs text-[var(--color-pos)]">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Matches. Nothing was dated on the bill date that month, so the cut-off did not matter.
        </span>
      </p>
    );
  }

  if (r.verdict.kind === 'resolved') {
    const { boundary } = r.verdict;
    const applied = r.current === boundary;
    return (
      <div className="flex flex-col gap-2">
        <p className="flex items-start gap-2 text-xs text-[var(--color-pos)]">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Matches when the bill date is{' '}
            <strong>{boundary === 'inclusive' ? 'included' : 'excluded'}</strong> — so that is what
            the bank did this month.
          </span>
        </p>
        {!applied ? (
          <Button size="sm" variant="secondary" pending={pending} onClick={() => onPin(boundary)}>
            Apply that to this statement
          </Button>
        ) : (
          <Badge tone="good">Already applied</Badge>
        )}
      </div>
    );
  }

  // Unexplained: the honest, and more useful, answer.
  const { inclusive, exclusive, shortfall } = r.verdict;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-start gap-2 text-xs text-[var(--color-warn)]">
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Neither cut-off explains this. The bank billed{' '}
          <span className="sensitive">{money(shortfall)}</span>{' '}
          {shortfall > 0 ? 'more' : 'less'} than anything recorded here accounts for.
        </span>
      </p>
      <p className="pl-5 text-[11px] text-[var(--color-ink-3)]">
        Including the bill date gives <span className="sensitive">{money(inclusive)}</span>;
        excluding it gives <span className="sensitive">{money(exclusive)}</span>. A missing
        transaction, an unrecorded fee, or a wrong amount would look like this.
      </p>
    </div>
  );
}

export function ReconcileClient({ card, statementDates, recorded }: Props) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();

  const [statementDate, setStatementDate] = useState(statementDates[0] ?? '');
  const [actual, setActual] = useState('');
  const [error, setError] = useState<string | undefined>();

  function record(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    startTransition(async () => {
      const result = await recordStatementAction({ card, statementDate, actual });
      if (!result.ok) {
        setError(result.fieldErrors?.['actual'] ?? result.error);
        notify('error', result.error);
        return;
      }
      setActual('');
      notify('success', 'Recorded. Compared against what the app computes.');
      router.refresh();
    });
  }

  function pin(date: string, boundary: StatementBoundary) {
    startTransition(async () => {
      const result = await setBoundaryAction({ card, statementDate: date, boundary });
      if (!result.ok) { notify('error', result.error); return; }
      notify('success', 'Cut-off applied to that statement.');
      router.refresh();
    });
  }

  return (
    <>
      <SectionTitle>Check against the bank</SectionTitle>

      <p className="mb-3 text-xs text-[var(--color-ink-2)]">
        Banks cut a statement partway through the bill date, so that day&rsquo;s spending lands on
        this statement some months and the next one other months. Enter the closing balance the
        bank printed and the app works out which way it went.
      </p>

      <form onSubmit={record} className="flex flex-wrap items-end gap-2">
        <Field label="Statement" htmlFor="statementDate" className="min-w-[9rem] flex-1">
          <select
            id="statementDate"
            value={statementDate}
            onChange={(e) => setStatementDate(e.target.value)}
            className={inputClass()}
          >
            {statementDates.map((d) => (
              <option key={d} value={d}>{formatDay(d)}</option>
            ))}
          </select>
        </Field>

        <Field
          label="Closing balance billed"
          htmlFor="actual"
          error={error}
          className="min-w-[9rem] flex-1"
        >
          <input
            id="actual"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className={`${inputClass(error)} num`}
          />
        </Field>

        <Button type="submit" pending={pending} className="mb-[2px]">
          Check
        </Button>
      </form>

      {recorded.length === 0 ? (
        <p className="mt-4 flex items-start gap-2 text-[11px] text-[var(--color-ink-3)]">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Nothing checked yet. Recording even one statement tells the app how this card behaves.
          </span>
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {recorded.map((r) => (
            <li
              key={r.statementDate}
              className="rounded-[var(--radius-field)] border border-[var(--color-line)] p-3"
            >
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{formatDay(r.statementDate)}</span>
                <span className="text-xs text-[var(--color-ink-3)]">
                  bank billed <Money value={r.actual} size="sm" className="font-semibold" />
                </span>
              </div>

              <Verdict r={r} pending={pending} onPin={(b) => pin(r.statementDate, b)} />

              {r.onBoundary.length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-[var(--color-ink-3)]">
                    {r.onBoundary.length} {r.onBoundary.length === 1 ? 'entry' : 'entries'} dated on
                    the bill date
                  </summary>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {r.onBoundary.map((t) => (
                      <li key={t.id} className="flex justify-between gap-3 text-[11px]">
                        <span className="truncate text-[var(--color-ink-2)]">
                          {t.remarks} · {t.direction}
                        </span>
                        <Money value={t.amount} size="sm" tone={t.direction === 'payment' ? 'credit' : 'neutral'} />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
