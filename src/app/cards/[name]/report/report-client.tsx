'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Link2, Printer } from 'lucide-react';
import { Badge, Money, cx, type BadgeTone } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, inputClass } from '@/components/ui/field';
import { AmountField, amountToSubmit } from '@/components/entry/amount-field';
import { InfoTip } from '@/components/ui/info-tip';
import { Private } from '@/contexts/privacy-context';
import { useToast } from '@/components/ui/toast';
import { assignRepaymentAction } from '@/app/income/actions';
import { INCOME_ACCOUNTS } from '@/lib/types';
import { formatDay, formatDayShort } from '@/lib/time';
import { planReturn, type LendingStatus, type ReportPerson, type UnlinkedReturn } from '@/lib/statement-report';
import { recordReturnAction } from './actions';

/* ===========================================================================
   The interactive parts of a statement report: picking the statement, printing
   it, and — the point of the lent section — saying that money came back.

   MARKING SOMETHING PAID RECORDS A RETURN, it does not tick a box. The money
   is income in the account it arrived in, linked to the person, and the credit
   ledger then settles their OLDEST lendings with it. So the form shows exactly
   which lendings an amount will settle before anything is saved: paying back
   the newest one while an older one is open settles the older one first, and a
   person should see that rather than discover it afterwards.
   =========================================================================== */

const STATUS: Record<LendingStatus, { label: string; tone: BadgeTone }> = {
  returned: { label: 'Returned', tone: 'good' },
  partly: { label: 'Part returned', tone: 'accent' },
  waiting: { label: 'Not returned', tone: 'warn' },
};

export function StatementPicker({
  card, value, options,
}: { card: string; value: string; options: { statementEnd: string; label: string }[] }) {
  const router = useRouter();
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-3)]">
      <span className="hidden sm:inline">Statement</span>
      <select
        aria-label="Which statement"
        value={value}
        onChange={(e) => router.push(`/cards/${encodeURIComponent(card)}/report?cycle=${e.target.value}`)}
        className={cx(inputClass(), 'h-8 w-auto py-0 text-xs font-medium text-[var(--color-ink)]')}
      >
        {options.map((o) => <option key={o.statementEnd} value={o.statementEnd}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function PrintButton() {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()} className="no-print">
      <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print / PDF
    </Button>
  );
}

/* --- The lent section ------------------------------------------------------- */

type Target = { person: ReportPerson; amount: number };

export function LentSection({
  people, unlinked, defaultTs,
}: { people: ReportPerson[]; unlinked: UnlinkedReturn[]; defaultTs: string }) {
  const [target, setTarget] = useState<Target | null>(null);

  return (
    <>
      <ul className="flex flex-col gap-3">
        {people.map((p) => {
          const pct = p.lent > 0 ? Math.min(100, (p.repaid / p.lent) * 100) : 0;
          const older = Math.max(0, p.allTime.outstanding - p.outstanding);
          return (
            <li key={p.person} className="rounded-[var(--radius-card)] border border-[var(--color-line)]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold"><Private>{p.person}</Private></span>
                    {p.outstanding < 0.005
                      ? <Badge tone="good">All returned</Badge>
                      : <Badge tone="warn">Still to come</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[var(--color-ink-3)]">
                    <span>Lent <Money value={p.lent} size="sm" /></span>
                    <span>Returned <Money value={p.repaid} size="sm" tone="credit" /></span>
                    {p.outstanding >= 0.005
                      ? <span>Left <Money value={p.outstanding} size="sm" tone="debt" className="font-semibold" /></span>
                      : null}
                  </div>
                </div>
                {p.outstanding >= 0.005 ? (
                  <Button size="sm" onClick={() => setTarget({ person: p, amount: p.outstanding })} className="no-print">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" /> Mark as paid
                  </Button>
                ) : null}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-raised)]" aria-hidden="true">
                  <div className="h-full rounded-full bg-[var(--color-pos)]" style={{ width: `${pct}%` }} />
                </div>
              </div>

              <ul className="border-t border-[var(--color-line)]">
                {p.lendings.map((l) => (
                  <li key={l.txId} className="border-b border-[var(--color-line)] px-3.5 py-2.5 text-xs last:border-b-0">
                    <div className="flex items-baseline gap-2.5">
                      <span className="w-12 shrink-0 text-[var(--color-ink-3)]">{formatDayShort(l.ts.slice(0, 10)).split(',')[0]}</span>
                      <span className="min-w-0 flex-1 truncate">{l.remarks || 'Lent'}</span>
                      <Money value={l.amount} size="sm" className="shrink-0 font-semibold" />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 pl-[3.625rem]">
                      <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                      <span className="min-w-0 flex-1 text-[11px] text-[var(--color-ink-3)]">
                        {l.status === 'returned'
                          ? 'Paid back in full'
                          : l.status === 'partly'
                            ? <>Back <Money value={l.repaid} size="sm" /> · <Money value={l.outstanding} size="sm" tone="debt" /> left</>
                            : `Waiting ${l.daysWaiting ?? 0} ${l.daysWaiting === 1 ? 'day' : 'days'}`}
                      </span>
                      {l.outstanding >= 0.005 ? (
                        <button
                          type="button"
                          onClick={() => setTarget({ person: p, amount: l.outstanding })}
                          className="no-print shrink-0 rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-accent)] hover:border-[var(--color-accent)]"
                        >
                          Mark paid
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>

              {p.returns.length > 0 || older > 0.005 ? (
                <div className="border-t border-[var(--color-line)] bg-[var(--color-canvas)]/40 px-3.5 py-2 text-[11px] text-[var(--color-ink-3)]">
                  {p.returns.length > 0 ? (
                    <>
                      <span className="font-medium text-[var(--color-ink-2)]">Paid back so far</span>
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {p.returns.slice(0, 4).map((r) => (
                          <li key={r.id} className="flex items-center gap-2">
                            <span className="w-24 shrink-0">{formatDay(r.ts.slice(0, 10))}</span>
                            <Money value={r.amount} size="sm" tone="credit" />
                            {r.account ? <span>into {r.account}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {older > 0.005 ? (
                    <p className="mt-1">
                      Also owes <Money value={older} size="sm" tone="debt" /> from earlier bills. A return settles the oldest lending first.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <ReturnDialog
        target={target}
        unlinked={unlinked}
        defaultTs={defaultTs}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

/* --- Recording a return ------------------------------------------------------ */

function ReturnDialog({
  target, unlinked, defaultTs, onClose,
}: { target: Target | null; unlinked: UnlinkedReturn[]; defaultTs: string; onClose: () => void }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ amount: '', account: 'Fi', ts: defaultTs, note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [clientKey, setClientKey] = useState('');

  const open = target !== null;
  useEffect(() => {
    if (!target) return;
    setErrors({});
    setClientKey(crypto.randomUUID());
    setForm({ amount: String(target.amount), account: 'Fi', ts: defaultTs, note: '' });
  }, [target, defaultTs]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // What this amount will settle, in the order the ledger settles things.
  const amountNum = Number(amountToSubmit(form.amount));
  const plan = useMemo(
    () => (target && Number.isFinite(amountNum) && amountNum > 0 ? planReturn(target.person.queue, amountNum) : null),
    [target, amountNum],
  );

  // Money already received but never linked to anyone: closest in amount first.
  const candidates = useMemo(
    () => [...unlinked].sort((a, b) => Math.abs(a.amount - amountNum) - Math.abs(b.amount - amountNum)).slice(0, 4),
    [unlinked, amountNum],
  );

  if (!target) return <Dialog open={false} onOpenChange={onClose} title="">{null}</Dialog>;
  const person = target.person.person;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    start(async () => {
      const r = await recordReturnAction({
        person, amount: amountToSubmit(form.amount), ts: form.ts, account: form.account, note: form.note, clientKey,
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        notify('error', r.error);
        return;
      }
      notify('success', `Recorded — marked as paid by ${person}.`);
      onClose();
      router.refresh();
    });
  }

  function link(u: UnlinkedReturn) {
    start(async () => {
      const r = await assignRepaymentAction({ id: u.id, person });
      if (!r.ok) { notify('error', r.error); return; }
      notify('success', `Linked to ${person}. Nothing new was recorded.`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Mark as paid — ${person}`}
      description="Record the money they paid back. It is added to the account you choose and counted against what they owe."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" form="return-form" pending={pending}>Record payment</Button>
        </>
      }
    >
      {candidates.length > 0 ? (
        <div className="mb-4 rounded-[var(--radius-field)] border border-dashed border-[var(--color-line-strong)] p-3">
          <p className="flex items-center gap-1 text-xs font-medium">
            Already recorded?
            <InfoTip label="What is this?">
              These are entries that look like money coming back but are not linked to anyone, so
              the lending still reads as unpaid. Linking one is better than recording it twice.
            </InfoTip>
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {candidates.map((u) => (
              <li key={u.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-[var(--color-ink-2)]">
                  {formatDay(u.ts.slice(0, 10))} · <Private>{u.note || u.source}</Private>
                </span>
                <Money value={u.amount} size="sm" />
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => link(u)}>
                  <Link2 className="h-3 w-3" aria-hidden="true" /> It was this
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form id="return-form" onSubmit={save} className="flex flex-col gap-3">
        <Field label="Amount returned" htmlFor="ret-amount" error={errors['amount']} hint="Or a sum like 5000+2000">
          <AmountField id="ret-amount" value={form.amount} onChange={(v) => set('amount', v)} error={errors['amount']} autoFocus />
        </Field>

        {plan ? (
          <div className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2 text-xs">
            <p className="font-medium">This will settle, oldest first:</p>
            <ul className="mt-1 flex flex-col gap-0.5 text-[var(--color-ink-2)]">
              {plan.lines.slice(0, 5).map((l) => (
                <li key={l.txId} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[var(--color-ink-3)]">{formatDayShort(l.ts.slice(0, 10)).split(',')[0]}</span>
                  <span className="min-w-0 flex-1 truncate">{l.remarks || 'Lent'}</span>
                  <Money value={l.apply} size="sm" />
                  <span className="w-10 shrink-0 text-right text-[10px] text-[var(--color-ink-3)]">{l.full ? 'in full' : 'part'}</span>
                </li>
              ))}
              {plan.lines.length > 5 ? <li className="text-[var(--color-ink-3)]">…and {plan.lines.length - 5} more</li> : null}
            </ul>
            {plan.extra > 0.005 ? (
              <p className="mt-1 text-[var(--color-warn)]">
                <Money value={plan.extra} size="sm" /> is more than they owe. The extra is not treated as a debt.
              </p>
            ) : null}
          </div>
        ) : null}

        <Field label="Received in" htmlFor="ret-account" error={errors['account']} hint="The account this money reached. Choose None if it never went into one.">
          <select id="ret-account" value={form.account} onChange={(e) => set('account', e.target.value)} className={inputClass(errors['account'])}>
            {INCOME_ACCOUNTS.map((a) => <option key={a} value={a}>{a === 'None' ? 'None — not in any account' : a}</option>)}
          </select>
        </Field>

        <Field label="Date and time it came back" htmlFor="ret-ts" error={errors['ts']}>
          <input
            id="ret-ts" type="datetime-local" step={1}
            value={form.ts.slice(0, 19)}
            onChange={(e) => set('ts', e.target.value.length === 16 ? `${e.target.value}:00` : e.target.value)}
            className={inputClass(errors['ts'])}
          />
        </Field>

        <Field label="Note (optional)" htmlFor="ret-note" error={errors['remarks']}>
          <input id="ret-note" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder={`Returned by ${person}`} className={inputClass(errors['remarks'])} />
        </Field>
      </form>
    </Dialog>
  );
}
