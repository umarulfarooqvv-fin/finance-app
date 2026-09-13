'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, TriangleAlert } from 'lucide-react';
import { formatDayShort } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Money } from '@/components/ui/primitives';
import { Private } from '@/contexts/privacy-context';
import { assignRepaymentAction } from './actions';

/* ===========================================================================
   Money that came back but settled nothing.

   The ledger finds the debtor by looking for a known name in the row's own
   text. When the remark says "Visiting card aquafenix" it finds nobody, the
   repayment attaches to nothing, and the lending it should have cleared stays
   outstanding — quietly, for ever.

   This is where that gets fixed. Saying who paid is a fact being recorded, not
   a guess being refined, so it overrides whatever the text implied.
   =========================================================================== */

export type Unattached = {
  id: string;
  day: string;
  amount: number;
  source: string;
  note: string;
  via: 'income' | 'transaction';
};

const NOT_A_RETURN = '__not_a_repayment__';

export function UnattachedRepayments({
  rows, people,
}: {
  rows: Unattached[];
  people: { person: string; outstanding: number }[];
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<Record<string, string>>({});

  function save(row: Unattached) {
    const picked = choice[row.id] ?? '';
    if (!picked) return;
    startTransition(async () => {
      const result = await assignRepaymentAction({
        id: row.id,
        person: picked === NOT_A_RETURN ? '' : picked,
      });
      if (!result.ok) { notify('error', result.error); return; }
      notify(
        'success',
        picked === NOT_A_RETURN
          ? 'Marked as not a repayment.'
          : `Linked to ${picked}. Their outstanding balance has been reduced.`,
      );
      router.refresh();
    });
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-field)] border border-[var(--color-line)] p-3"
        >
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
          <span className="num w-24 shrink-0 text-xs text-[var(--color-ink-3)]">
            {formatDayShort(r.day)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">
            <Private>{r.note || r.source}</Private>
          </span>
          <Money value={r.amount} size="sm" tone="credit" className="shrink-0" />

          <div className="flex w-full items-end gap-2 sm:w-auto">
            <select
              value={choice[r.id] ?? ''}
              onChange={(e) => setChoice((c) => ({ ...c, [r.id]: e.target.value }))}
              aria-label={`Who returned ${r.amount}`}
              className={`${inputClass()} min-w-[10rem]`}
            >
              <option value="">Who paid this?</option>
              {people.map((p) => (
                <option key={p.person} value={p.person}>
                  {p.person}
                </option>
              ))}
              <option value={NOT_A_RETURN}>Not a repayment</option>
            </select>
            <Button
              size="sm"
              disabled={pending || !choice[r.id]}
              onClick={() => save(r)}
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              Link
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
