'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, inputClass } from '@/components/ui/field';
import { Money } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { AmountField, amountToSubmit } from '@/components/entry/amount-field';
import { createTransactionAction } from '@/app/transactions/actions';
import { billRemarks } from '@/lib/bill-pay';
import { nowIST } from '@/lib/time';
import { cn } from '@/lib/cn';

/* ===========================================================================
   "Mark as paid" on a card's bill — then which account paid it.

   Saves an ordinary entry through the ordinary create action: method = the
   account, category = the card, so the statement view applies it to the bill
   like any payment typed in by hand (lib/bill-pay). The amount starts at
   what is due and can be changed for a part payment; the time is now, and
   can be moved back for a bill paid earlier and not yet logged.

   The accounts come in the order this card was last paid from, the most
   recent already chosen: the usual case is two taps.
   =========================================================================== */

export function MarkBillPaid({
  card, due, payers, compact = false,
}: {
  card: string;
  /** What is still due on the bill. */
  due: number;
  /** Accounts that can pay it, the usual one first (lib/bill-pay). */
  payers: string[];
  /** A small button for a table cell. */
  compact?: boolean;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: '', method: '', ts: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Minted once per opening: a double tap or a retry saves one entry, not two.
  const [clientKey, setClientKey] = useState('');

  if (due <= 0) return null;

  const openForm = () => {
    setErrors({});
    setClientKey(crypto.randomUUID());
    setForm({ amount: due.toFixed(2), method: payers[0] ?? '', ts: nowIST() });
    setOpen(true);
  };

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.method) { setErrors({ method: 'Choose the account that paid it.' }); return; }
    setErrors({});
    start(async () => {
      const r = await createTransactionAction({
        amount: amountToSubmit(form.amount),
        method: form.method,
        category: card,
        remarks: billRemarks(card),
        ts: form.ts,
        clientKey,
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        notify('error', r.error);
        return;
      }
      notify('success', r.data.duplicate ? 'Already recorded.' : `${card} bill paid from ${form.method}.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant={compact ? 'secondary' : 'primary'}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); openForm(); }}
        aria-label={`Mark the ${card} bill as paid`}
        className={cn('shrink-0', compact && 'h-7 px-2')}
      >
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        {compact ? 'Mark paid' : 'Mark as paid'}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => !pending && setOpen(o)}
        title={`Pay the ${card} bill`}
        description="Recorded as a bill payment from the account you choose. It clears the bill first; anything over it comes off the unbilled amount."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" form={`pay-${card}`} pending={pending}>
              <Check className="h-4 w-4" aria-hidden="true" /> Mark as paid
            </Button>
          </>
        }
      >
        <form id={`pay-${card}`} onSubmit={save} className="flex flex-col gap-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-2)]">Paid from</p>
            <div role="radiogroup" aria-label="Paid from" className="flex flex-wrap gap-1.5">
              {payers.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={form.method === m}
                  onClick={() => set('method', m)}
                  className={cn(
                    'h-9 rounded-full border px-3.5 text-sm transition-colors',
                    form.method === m
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
                      : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)]',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            {errors['method'] ? <p className="mt-1 text-xs text-[var(--color-neg)]">{errors['method']}</p> : null}
          </div>

          <Field label="Amount" htmlFor={`pay-${card}-amount`} error={errors['amount']} hint="Change it for a part payment">
            <AmountField id={`pay-${card}-amount`} value={form.amount} onChange={(v) => set('amount', v)} error={errors['amount']} />
          </Field>
          <p className="-mt-2 text-[11px] text-[var(--color-ink-3)]">
            Due on this bill: <Money value={due} size="sm" />
          </p>

          <Field label="Paid on" htmlFor={`pay-${card}-ts`} error={errors['ts']}>
            <input
              id={`pay-${card}-ts`} type="datetime-local" step={1}
              value={form.ts.slice(0, 19)}
              onChange={(e) => set('ts', e.target.value.length === 16 ? `${e.target.value}:00` : e.target.value)}
              className={inputClass(errors['ts'])}
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
