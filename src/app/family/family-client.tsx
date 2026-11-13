'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, MinusCircle, Plus, PlusCircle, Settings2, Trash2 } from 'lucide-react';
import { Badge, Money, Panel, SectionTitle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, inputClass } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { AmountField, amountToSubmit } from '@/components/entry/amount-field';
import { cn } from '@/lib/cn';
import { formatDayShort, formatMonth } from '@/lib/time';
import type { FamilyConfig, FamilyGroup, FamilyMember, FamilyView, GroupView, MemberTally } from '@/lib/family';
import {
  addFamilyPaymentAction, deleteFamilyPaymentAction, excludeFromGroupAction, saveFamilySetupAction,
} from './actions';

/* The family page's screen: the summary, one panel per cost group, and the
   two forms — a payment typed in for someone, and the setup (who is in the
   split, which costs are shared and how). See lib/family for the maths. */

const ROWS = 6;

function nameOf(members: FamilyMember[], id: string) {
  return members.find((m) => m.id === id)?.name ?? 'Someone';
}

/* "Behind ₹10,000" / "Ahead ₹2,500" / "Settled". */
function BalanceText({ t, kind }: { t: MemberTally; kind: 'shared' | 'pledge' | 'summary' }) {
  if (Math.abs(t.balance) < 0.5) return <span className="text-[var(--color-ink-3)]">Settled</span>;
  const behind = t.balance < 0;
  const word = kind === 'shared'
    ? (behind ? 'Owes' : 'Paid extra')
    : (behind ? 'Behind' : 'Ahead');
  return (
    <span className={behind ? 'text-[var(--color-neg)]' : 'text-[var(--color-pos)]'}>
      {word} <Money value={Math.abs(t.balance)} size="sm" tone="neutral" className="text-inherit" />
    </span>
  );
}

function TallyTable({ tally, members, kind }: { tally: MemberTally[]; members: FamilyMember[]; kind: 'shared' | 'pledge' | 'summary' }) {
  const owedLabel = kind === 'pledge' ? 'Due so far' : kind === 'shared' ? 'Their share' : 'Share + due';
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
      <span className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">Person</span>
      <span className="text-right text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">Paid</span>
      <span className="hidden text-right text-[11px] uppercase tracking-wide text-[var(--color-ink-3)] sm:block">{owedLabel}</span>
      <span className="text-right text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">Where they stand</span>
      {tally.map((t) => (
        <div key={t.member} className="contents">
          <span className="min-w-0 truncate font-medium">{nameOf(members, t.member)}</span>
          <span className="text-right"><Money value={t.paid} size="sm" /></span>
          <span className="hidden text-right sm:block"><Money value={t.owed} size="sm" tone="muted" /></span>
          <span className="text-right text-xs"><BalanceText t={t} kind={kind} /></span>
        </div>
      ))}
    </div>
  );
}

export function FamilyClient({
  view, cfg, saved, today,
}: {
  view: FamilyView;
  cfg: FamilyConfig;
  saved: boolean;
  today: string;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [payFor, setPayFor] = useState<FamilyGroup | null>(null);
  const counted = view.groups.filter((g) => g.group.inTotal).map((g) => g.group.name);
  const apart = view.groups.filter((g) => !g.group.inTotal).map((g) => g.group.name);

  return (
    <>
      {!saved ? (
        <Panel className="mb-4 border-[var(--color-accent)]">
          <p className="text-sm font-medium">A suggested start — check it, then save</p>
          <p className="mt-1 text-xs text-[var(--color-ink-2)]">
            Car at ₹5,000 a month each from September 2025, and Uppa’s hospital kept out of the total, both
            filled from your own entries. Put in your brother’s name, and add any other shared cost.
          </p>
          <Button size="sm" className="mt-3" onClick={() => setSetupOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Set up
          </Button>
        </Panel>
      ) : null}

      <Panel>
        <SectionTitle action={
          <Button size="sm" variant="secondary" onClick={() => setSetupOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> People and costs
          </Button>
        }>
          Summary
        </SectionTitle>
        <TallyTable tally={view.summary} members={view.members} kind="summary" />
        <p className="mt-3 text-[11px] text-[var(--color-ink-3)]">
          {counted.length ? <>Counts {counted.join(', ')}.</> : 'No cost is counted in the summary yet.'}
          {apart.length ? <> Kept apart: {apart.join(', ')}.</> : null}
        </p>
      </Panel>

      {view.groups.map((g) => (
        <GroupPanel key={g.group.id} g={g} cfg={cfg} members={view.members} today={today} onAdd={() => setPayFor(g.group)} />
      ))}

      <PaymentDialog group={payFor} members={view.members} today={today} onClose={() => setPayFor(null)} />
      <SetupDialog open={setupOpen} cfg={cfg} onClose={() => setSetupOpen(false)} />
    </>
  );
}

function GroupPanel({
  g, cfg, members, today, onAdd,
}: {
  g: GroupView; cfg: FamilyConfig; members: FamilyMember[]; today: string; onAdd: () => void;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, start] = useTransition();
  const [allRows, setAllRows] = useState(false);
  const [showMonths, setShowMonths] = useState(false);
  const { group } = g;

  const toggleTotal = () =>
    start(async () => {
      const res = await saveFamilySetupAction({
        members: cfg.members,
        groups: cfg.groups.map((x) => (x.id === group.id ? { ...x, inTotal: !x.inTotal } : x)),
      });
      if (!res.ok) { notify('error', res.error); return; }
      router.refresh();
    });

  const leaveOut = (tx: string, out: boolean) =>
    start(async () => {
      const res = await excludeFromGroupAction({ group: group.id, tx, out });
      if (!res.ok) { notify('error', res.error); return; }
      notify('success', out ? `Left out of ${group.name}.` : `Back in ${group.name}.`);
      router.refresh();
    });

  const remove = (id: string) =>
    start(async () => {
      const res = await deleteFamilyPaymentAction({ id });
      if (!res.ok) { notify('error', res.error); return; }
      router.refresh();
    });

  const rows = allRows ? g.rows : g.rows.slice(0, ROWS);
  const monthsShort = group.kind === 'pledge' && group.monthly
    ? g.months.filter((m) => members.some((p) => p.from <= `${m.key}-31` && (m.paid[p.id] ?? 0) < group.monthly!)).length
    : 0;

  return (
    <Panel className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {group.name}
            <Badge tone="neutral">{group.kind === 'pledge' ? 'Monthly share' : 'Split equally'}</Badge>
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">
            {group.kind === 'pledge' && group.monthly ? (
              <>
                <Money value={group.monthly} size="sm" tone="muted" /> a month each from{' '}
                {group.from ? formatMonth(group.from.slice(0, 7)) : 'the start'} · <Money value={g.total} size="sm" tone="muted" /> put in so far
              </>
            ) : (
              <>
                <Money value={g.total} size="sm" tone="muted" /> paid in all · split among whoever was in it on the day
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
            <input type="checkbox" checked={group.inTotal} disabled={pending} onChange={toggleTotal} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
            In the summary
          </label>
          <Button size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a payment
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <TallyTable tally={g.tally} members={members} kind={group.kind} />
      </div>

      {group.kind === 'pledge' && g.months.length ? (
        <div className="mt-4">
          <button type="button" onClick={() => setShowMonths((s) => !s)} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)]">
            {showMonths ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Month by month{monthsShort ? ` · ${monthsShort} short` : ''}
          </button>
          {showMonths ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[var(--color-ink-3)]">
                    <th className="py-1 text-left font-medium">Month</th>
                    {members.map((m) => <th key={m.id} className="py-1 text-right font-medium">{m.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {g.months.map((mo) => (
                    <tr key={mo.key} className="border-t border-[var(--color-line)]">
                      <td className="py-1.5 pr-3">{formatMonth(mo.key)}{mo.key === today.slice(0, 7) ? ' (this month)' : ''}</td>
                      {members.map((m) => {
                        const inIt = m.from <= `${mo.key}-31`;
                        const paid = mo.paid[m.id] ?? 0;
                        const short = inIt && paid < (group.monthly ?? 0);
                        return (
                          <td key={m.id} className={cn('py-1.5 text-right', short && 'text-[var(--color-neg)]')}>
                            {!inIt ? <span className="text-[var(--color-ink-3)]">—</span>
                              : paid ? <Money value={paid} size="sm" tone="neutral" className="text-inherit" />
                              : 'Nothing'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 border-t border-[var(--color-line)] pt-3">
        <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">
          Payments ({g.rows.length}){group.match.length ? <span className="normal-case tracking-normal"> · yours found by “{group.match.join('”, “')}”</span> : null}
        </p>
        {g.rows.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-3)]">None yet. Add a brother’s payment, or add words in “People and costs” that find your own entries.</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 border-b border-[var(--color-line)] py-1.5 text-xs last:border-b-0">
                <span className="w-16 shrink-0 text-[var(--color-ink-3)]">{formatDayShort(r.day).split(',')[0]}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{nameOf(members, r.member)}</span>
                  {r.note ? <span className="text-[var(--color-ink-3)]"> · {r.note}</span> : null}
                  {r.from === 'ledger' ? <span className="text-[var(--color-ink-3)]"> · your entry</span> : null}
                </span>
                <Money value={r.amount} size="sm" />
                {r.from === 'ledger' ? (
                  <button type="button" disabled={pending} onClick={() => leaveOut(r.id, true)}
                    title="Not part of this cost — leave it out" aria-label={`Leave ${r.note || 'this entry'} out of ${group.name}`}
                    className="text-[var(--color-ink-3)] hover:text-[var(--color-neg)]">
                    <MinusCircle className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : (
                  <button type="button" disabled={pending} onClick={() => remove(r.id)}
                    aria-label={`Delete this payment by ${nameOf(members, r.member)}`}
                    className="text-[var(--color-ink-3)] hover:text-[var(--color-neg)]">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {g.rows.length > ROWS ? (
          <button type="button" onClick={() => setAllRows((a) => !a)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)]">
            {allRows ? <>Show fewer <ChevronUp className="h-3.5 w-3.5" /></> : <>Show all {g.rows.length} <ChevronDown className="h-3.5 w-3.5" /></>}
          </button>
        ) : null}
        {group.exclude?.length ? (
          <p className="mt-2 text-[11px] text-[var(--color-ink-3)]">
            {group.exclude.length} of your entries left out.{' '}
            <button type="button" disabled={pending} className="text-[var(--color-accent)]"
              onClick={() => group.exclude!.forEach((tx) => leaveOut(tx, false))}>
              <PlusCircle className="mr-0.5 inline h-3 w-3" aria-hidden="true" />Put them back
            </button>
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

/* --- A payment typed in --------------------------------------------------- */

function PaymentDialog({
  group, members, today, onClose,
}: { group: FamilyGroup | null; members: FamilyMember[]; today: string; onClose: () => void }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ member: '', amount: '', day: today, note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [clientKey, setClientKey] = useState('');
  const [openFor, setOpenFor] = useState<string | null>(null);

  // Reset each time the dialog opens for a group.
  if (group && openFor !== group.id) {
    setOpenFor(group.id);
    setErrors({});
    setClientKey(crypto.randomUUID());
    const brother = members.find((m) => !m.me) ?? members[0];
    setForm({ member: brother?.id ?? '', amount: group.kind === 'pledge' && group.monthly ? String(group.monthly) : '', day: today, note: '' });
  }
  if (!group && openFor !== null) setOpenFor(null);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!group) return;
    start(async () => {
      const res = await addFamilyPaymentAction({
        group: group.id, member: form.member, amount: amountToSubmit(form.amount), day: form.day, note: form.note, clientKey,
      });
      if (!res.ok) { setErrors(res.fieldErrors ?? {}); notify('error', res.error); return; }
      notify('success', `${nameOf(members, form.member)}’s payment added to ${group.name}.`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={group !== null}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={group ? `Add a payment — ${group.name}` : ''}
      description="Usually a brother’s. It is kept on this page only; your own accounts do not change. Your own payments come from your entries."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" form="family-pay" pending={pending}>Add payment</Button>
        </>
      }
    >
      <form id="family-pay" onSubmit={save} className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-2)]">Paid by</p>
          <div role="radiogroup" aria-label="Paid by" className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={form.member === m.id} onClick={() => set('member', m.id)}
                className={cn('h-9 rounded-full border px-3.5 text-sm',
                  form.member === m.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
                    : 'border-[var(--color-line)] text-[var(--color-ink-2)]')}>
                {m.name}
              </button>
            ))}
          </div>
          {errors['member'] ? <p className="mt-1 text-xs text-[var(--color-neg)]">{errors['member']}</p> : null}
        </div>
        <Field label="Amount" htmlFor="fp-amount" error={errors['amount']}>
          <AmountField id="fp-amount" value={form.amount} onChange={(v) => set('amount', v)} error={errors['amount']} />
        </Field>
        <Field label="Paid on" htmlFor="fp-day" error={errors['day']}>
          <input id="fp-day" type="date" value={form.day} onChange={(e) => set('day', e.target.value)} className={inputClass(errors['day'])} />
        </Field>
        <Field label="Note (optional)" htmlFor="fp-note">
          <input id="fp-note" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. October EMI" className={inputClass()} />
        </Field>
      </form>
    </Dialog>
  );
}

/* --- Who is in the split, and the costs ----------------------------------- */

type GroupDraft = Omit<FamilyGroup, 'monthly' | 'match'> & { monthly: string; match: string };

function SetupDialog({ open, cfg, onClose }: { open: boolean; cfg: FamilyConfig; onClose: () => void }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, start] = useTransition();
  const initial = useMemo(() => ({
    members: cfg.members.map((m) => ({ ...m })),
    groups: cfg.groups.map((g): GroupDraft => ({ ...g, monthly: g.monthly ? String(g.monthly) : '', match: g.match.join(', ') })),
  }), [cfg]);
  const [members, setMembers] = useState(initial.members);
  const [groups, setGroups] = useState(initial.groups);
  const [wasOpen, setWasOpen] = useState(false);

  if (open && !wasOpen) {
    setWasOpen(true);
    setMembers(initial.members);
    setGroups(initial.groups);
  }
  if (!open && wasOpen) setWasOpen(false);

  const setM = (i: number, patch: Partial<FamilyMember>) => setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const setG = (i: number, patch: Partial<GroupDraft>) => setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  function save() {
    const out: FamilyGroup[] = groups.map((g) => ({
      id: g.id, name: g.name.trim(), kind: g.kind, inTotal: g.inTotal,
      match: g.match.split(',').map((w) => w.trim()).filter(Boolean),
      ...(g.kind === 'pledge' ? { monthly: Number(amountToSubmit(g.monthly)) || 0, ...(g.from ? { from: g.from } : {}) } : {}),
      ...(g.exclude?.length ? { exclude: g.exclude } : {}),
    }));
    start(async () => {
      const res = await saveFamilySetupAction({ members: members.map((m) => ({ ...m, name: m.name.trim() })), groups: out });
      if (!res.ok) { notify('error', res.error); return; }
      notify('success', 'Saved.');
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !pending && onClose()}
      title="People and costs"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} pending={pending}>Save</Button>
        </>
      }
    >
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">In the split</h3>
        <p className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">
          “Joined” is the first day someone shares the costs. A brother who joins later shares only what is paid after that day, and owes a monthly share only from that month.
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {members.map((m, i) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2">
              <input value={m.name} onChange={(e) => setM(i, { name: e.target.value })} aria-label="Name"
                className={cn(inputClass(), 'min-w-0 flex-1 basis-32 text-sm')} />
              <label className="flex items-center gap-1 text-xs text-[var(--color-ink-3)]">
                Joined
                <input type="date" value={m.from} onChange={(e) => setM(i, { from: e.target.value })}
                  aria-label={`${m.name} joined on`} className={cn(inputClass(), 'w-40 text-xs')} />
              </label>
              {m.me ? <Badge tone="neutral">You</Badge> : (
                <Button variant="ghost" size="icon" aria-label={`Remove ${m.name}`} onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Button size="sm" variant="secondary" className="mt-2"
          onClick={() => setMembers((ms) => [...ms, { id: `m${Date.now()}`, name: 'Brother', from: new Date().toISOString().slice(0, 10) }])}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a person
        </Button>
      </section>

      <section className="mt-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">Shared costs</h3>
        <p className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">
          “Find my entries by” takes tags or words from your entries, separated by commas — “car contribution” finds “Car Contribution 6” but not “Car fuel”.
        </p>
        <ul className="mt-2 flex flex-col gap-3">
          {groups.map((g, i) => (
            <li key={g.id} className="rounded-[var(--radius-field)] border border-[var(--color-line)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input value={g.name} onChange={(e) => setG(i, { name: e.target.value })} aria-label="Name of the cost"
                  placeholder="e.g. Sister’s EMI" className={cn(inputClass(), 'min-w-0 flex-1 basis-40 text-sm font-medium')} />
                <select value={g.kind} onChange={(e) => setG(i, { kind: e.target.value as FamilyGroup['kind'] })} aria-label="How it is shared"
                  className={cn(inputClass(), 'w-44 text-xs')}>
                  <option value="shared">Split equally</option>
                  <option value="pledge">Monthly share each</option>
                </select>
                <Button variant="ghost" size="icon" aria-label={`Remove ${g.name}`} onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
              {g.kind === 'pledge' ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-3)]">
                  Each puts in
                  <input value={g.monthly} onChange={(e) => setG(i, { monthly: e.target.value })} inputMode="decimal" aria-label="Amount a month each"
                    placeholder="5000" className={cn(inputClass(), 'num w-28 text-xs')} />
                  a month from
                  <input type="date" value={g.from ?? ''} onChange={(e) => setG(i, { from: e.target.value })} aria-label="From"
                    className={cn(inputClass(), 'w-40 text-xs')} />
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="min-w-0 flex-1 basis-60 text-xs text-[var(--color-ink-3)]">
                  Find my entries by
                  <input value={g.match} onChange={(e) => setG(i, { match: e.target.value })} placeholder="car contribution, sister emi"
                    className={cn(inputClass(), 'mt-1 w-full text-xs')} />
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
                  <input type="checkbox" checked={g.inTotal} onChange={(e) => setG(i, { inTotal: e.target.checked })} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
                  In the summary
                </label>
              </div>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="secondary" className="mt-2"
          onClick={() => setGroups((gs) => [...gs, { id: `g${Date.now()}`, name: '', kind: 'shared', match: '', monthly: '', inTotal: true }])}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a cost
        </Button>
      </section>
    </Dialog>
  );
}
