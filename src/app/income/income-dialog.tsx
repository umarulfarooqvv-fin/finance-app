'use client';

import { useEffect, useState, useTransition } from 'react';
import { INCOME_ACCOUNTS, INCOME_SOURCES } from '@/lib/types';
import { nowIST } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, inputClass } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { assignRepaymentAction, createIncomeAction, updateIncomeAction } from './actions';

/* ===========================================================================
   Adding or correcting one income entry.

   The client key is minted ONCE per opening of the dialog, not per submit, so
   a double-tap or a retry resolves to the same id and upserts instead of
   recording the salary twice. Same rule as the spending form.

   Source is a free-text field with suggestions rather than a closed list: the
   Shortcut can post a source nobody anticipated, and a form that refuses what
   the API accepts would make an entry uneditable in the app that received it.
   =========================================================================== */

export type EditableIncome = {
  id: string;
  ts: string;
  amount: number;
  source: string;
  account: string;
  remarks: string;
};

/** Someone who still owes money, offered when recording a return. */
export type Debtor = { person: string; outstanding: number };

/* Three states, and the select must keep them apart:
     ''            no decision - let the ledger read the remarks
     a person      this repayment is from them
     NOT_A_RETURN  it only looks like a repayment; ignore it
   The last is sent to the server as an empty person, which is what the ledger
   reads as "excluded on purpose". */
const NOT_A_RETURN = '__not_a_repayment__';

const blank = (defaultTs: string) => ({
  amount: '', source: '', account: 'Fi', remarks: '', ts: defaultTs,
});

export function IncomeDialog({
  open, onOpenChange, editing, defaultTs, onSaved, debtors,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: EditableIncome | null;
  defaultTs: string;
  onSaved: () => void;
  debtors: Debtor[];
}) {
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(blank(defaultTs));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [clientKey, setClientKey] = useState('');
  const [person, setPerson] = useState('');

  useEffect(() => {
    if (!open) return;
    setErrors({});
    // One key per opening. Minting it on submit would defeat the point.
    setClientKey(`${nowIST()}-${Math.random().toString(36).slice(2, 10)}`);
    setPerson('');
    setForm(
      editing
        ? {
            amount: String(editing.amount),
            source: editing.source,
            account: editing.account,
            remarks: editing.remarks,
            ts: editing.ts,
          }
        : blank(defaultTs),
    );
  }, [open, editing, defaultTs]);

  /* "Credit Return" is the source the ledger already treats as money coming
     back; naming the person turns a guess into a fact. */
  const isReturn = /credit\s*return|repay|returned|paid\s*back/i.test(form.source);
  const owed = debtors.find((d) => d.person === person) ?? null;

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = editing
        ? await updateIncomeAction({ ...form, id: editing.id })
        : await createIncomeAction({ ...form, clientKey });

      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        notify('error', result.error);
        return;
      }

      /* Record WHO paid, rather than hoping the ledger reads it out of the
         remarks. Matching on text is what leaves a repayment attached to
         nobody, and a lending outstanding years after the cash came back. */
      if (isReturn && person) {
        const assigned = await assignRepaymentAction({
          id: result.data.id,
          person: person === NOT_A_RETURN ? '' : person,
        });
        if (!assigned.ok) notify('error', `Saved, but not linked: ${assigned.error}`);
      }
      if (!editing && 'duplicate' in result.data && result.data.duplicate) {
        notify('success', 'Already saved — this was the same entry.');
      } else {
        notify('success', editing ? 'Income updated.' : 'Income recorded.');
      }
      onOpenChange(false);
      onSaved();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit income' : 'Record income'}
      description="Money coming in. Spending is recorded separately, under Entries."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="income-form" pending={pending}>
            {editing ? 'Save' : 'Record'}
          </Button>
        </>
      }
    >
      <form id="income-form" onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Amount" htmlFor="inc-amount" error={errors['amount']}>
          <input
            id="inc-amount" inputMode="decimal" autoFocus value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
            placeholder="0.00"
            className={`${inputClass(errors['amount'])} num`}
          />
        </Field>

        <Field
          label="Source"
          htmlFor="inc-source"
          error={errors['source']}
          hint="Where it came from. Pick one or type your own."
        >
          <input
            id="inc-source" list="income-sources" value={form.source}
            onChange={(e) => set('source', e.target.value)}
            className={inputClass(errors['source'])}
          />
          <datalist id="income-sources">
            {INCOME_SOURCES.map((s) => <option key={s} value={s} />)}
          </datalist>
        </Field>

        <Field
          label="Received in"
          htmlFor="inc-account"
          error={errors['account']}
          hint="Use None if it never reached an account."
        >
          <select
            id="inc-account" value={form.account}
            onChange={(e) => set('account', e.target.value)}
            className={inputClass(errors['account'])}
          >
            {INCOME_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>

        {isReturn ? (
          <Field
            label="Returned by"
            htmlFor="inc-person"
            hint={
              owed
                ? `${owed.person} still has ${owed.outstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })} outstanding.`
                : 'Who paid you back. This links the entry to what they owe.'
            }
          >
            <select
              id="inc-person"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              className={inputClass()}
            >
              <option value="">Work it out from the remarks</option>
              {debtors.map((d) => (
                <option key={d.person} value={d.person}>{d.person}</option>
              ))}
              <option value={NOT_A_RETURN}>Not a repayment</option>
            </select>
          </Field>
        ) : null}

        <Field label="When" htmlFor="inc-ts" error={errors['ts']}>
          <input
            id="inc-ts" type="datetime-local" step={1}
            value={form.ts.slice(0, 19)}
            onChange={(e) => set('ts', e.target.value.length === 16 ? `${e.target.value}:00` : e.target.value)}
            className={inputClass(errors['ts'])}
          />
        </Field>

        <Field label="Remarks" htmlFor="inc-remarks" error={errors['remarks']}>
          <input
            id="inc-remarks" value={form.remarks}
            onChange={(e) => set('remarks', e.target.value)}
            placeholder="What was it for?"
            className={inputClass(errors['remarks'])}
          />
        </Field>
      </form>
    </Dialog>
  );
}
