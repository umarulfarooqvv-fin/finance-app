'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, inputClass } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { AmountField, amountToSubmit } from '@/components/entry/amount-field';
import { settleCreditAction } from './actions';

/* ===========================================================================
   "This came back."

   It asks rather than just doing it, for one reason: the amount. Settling the
   whole balance is the common case and is offered ready-filled, but a part
   payment is the case that goes unrecorded for years precisely because there
   was nowhere to put it.

   What it writes is a REPAYMENT, not a deletion. The lending stays in the
   ledger and in the spending it belongs to; the repayment nets against it.
   =========================================================================== */

export function SettleButton({ person, outstanding }: { person: string; outstanding: number }) {
  const router = useRouter();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(outstanding.toFixed(2));
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await settleCreditAction({
        person,
        amount: amountToSubmit(amount),
        note,
      });
      if (!result.ok) { notify('error', result.error); return; }
      notify('success', `Recorded as come back from ${person}.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => { setAmount(outstanding.toFixed(2)); setNote(''); setOpen(true); }}
        aria-label={`Record money come back from ${person}`}
      >
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        Came back
      </Button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Money back from ${person}`}
        description="This records a repayment. The lending stays in the ledger, and the two net off."
      >
        <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
          <Field
            label="How much came back"
            htmlFor="settle-amount"
            hint={`${outstanding.toFixed(2)} is outstanding — change it for a part payment`}
          >
            <AmountField
              id="settle-amount"
              value={amount}
              onChange={setAmount}
              autoFocus
            />
          </Field>

          <Field label="Note" htmlFor="settle-note" hint="Optional — how it came back">
            <input
              id="settle-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Cash, UPI, adjusted against something…"
              className={inputClass()}
            />
          </Field>

          <p className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2 text-[11px] text-[var(--color-ink-2)]">
            Recorded by hand, for money that never passed through an account. If it DID arrive in
            an account, record it as income instead — that way the balance on the account is right
            as well as the ledger.
          </p>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" pending={pending}>Record it</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
