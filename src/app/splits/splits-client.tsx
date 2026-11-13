'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, ChevronDown, ChevronUp, ListPlus, MinusCircle, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { Empty, Money, Panel } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, inputClass } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { AmountField, amountToSubmit } from '@/components/entry/amount-field';
import { cn } from '@/lib/cn';
import { formatDayShort } from '@/lib/time';
import { ME, type Split, type SplitPerson, type SplitView, type Transfer } from '@/lib/splits';
import {
  addSplitExpenseAction, deleteSettlementAction, deleteSplitAction, deleteSplitExpenseAction,
  excludeFromSplitAction, includeInSplitAction, saveSplitAction, settleSplitAction,
} from './actions';

/** One of your Credit Given entries not yet in a split. */
export type Candidate = { id: string; day: string; amount: number; remarks: string; method: string };

/* The Splits screen: a list of splits, one open at a time, each with "who
   pays whom" first — the thing a person opens it for — then the expenses.
   Two forms: a split (name, friends, the tag that finds your entries) and an
   expense (who paid, how much, for whom). See lib/splits for the maths. */

const nameOf = (people: SplitPerson[], id: string) => people.find((p) => p.id === id)?.name ?? 'Someone';

function Stand({ v, className }: { v: number; className?: string }) {
  if (Math.abs(v) < 0.5) return <span className={cn('text-xs text-[var(--color-ink-3)]', className)}>Settled</span>;
  return v > 0
    ? <span className={cn('text-xs text-[var(--color-pos)]', className)}>You get <Money value={v} size="sm" tone="neutral" className="text-inherit" /></span>
    : <span className={cn('text-xs text-[var(--color-neg)]', className)}>You owe <Money value={-v} size="sm" tone="neutral" className="text-inherit" /></span>;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick}
      className={cn('h-8 rounded-full border px-3 text-xs transition-colors',
        on ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
          : 'border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)]')}>
      {children}
    </button>
  );
}

export function SplitsClient({
  views, tags, today, candidates,
}: { views: SplitView[]; tags: string[]; today: string; candidates: Candidate[] }) {
  const [open, setOpen] = useState<string | null>(views[0]?.split.id ?? null);
  const [editing, setEditing] = useState<Split | 'new' | null>(null);
  const [adding, setAdding] = useState<SplitView | null>(null);
  const [picking, setPicking] = useState<SplitView | null>(null);
  const [settling, setSettling] = useState<{ v: SplitView; t: Transfer } | null>(null);

  const getBack = views.reduce((s, v) => s + Math.max(0, v.mine), 0);
  const owe = views.reduce((s, v) => s + Math.max(0, -v.mine), 0);
  const recovered = views.reduce((s, v) => s + v.recovered, 0);
  const lost = views.reduce((s, v) => s + v.lost, 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-1 text-sm">
          <span>Friends owe you <Money value={getBack} size="md" className="font-semibold text-[var(--color-pos)]" /></span>
          {owe > 0.5 ? <span>You owe <Money value={owe} size="md" className="font-semibold text-[var(--color-neg)]" /></span> : null}
          {recovered > 0.5 ? <span className="text-[var(--color-ink-2)]">Got back <Money value={recovered} size="md" /></span> : null}
          {lost > 0.5 ? <span className="text-[var(--color-ink-2)]">Lost <Money value={lost} size="md" className="text-[var(--color-neg)]" /></span> : null}
        </div>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New split
        </Button>
      </div>

      {views.length === 0 ? (
        <Panel>
          <Empty
            icon={<Users className="h-6 w-6" aria-hidden="true" />}
            title="No splits yet"
            hint="Start one for a trip or a meal out. Add your friends, choose the tag your entries for it carry, and add what they paid."
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          {views.map((v) => (
            <SplitCard key={v.split.id} v={v} open={open === v.split.id} today={today}
              onToggle={() => setOpen((o) => (o === v.split.id ? null : v.split.id))}
              onEdit={() => setEditing(v.split)} onAdd={() => setAdding(v)} onPick={() => setPicking(v)}
              onSettle={(t) => setSettling({ v, t })} />
          ))}
        </div>
      )}

      <SplitForm split={editing} tags={tags} today={today} onClose={() => setEditing(null)} onSaved={(id) => setOpen(id)} />
      <ExpenseForm v={adding} today={today} onClose={() => setAdding(null)} />
      <PickEntries v={picking} candidates={candidates} onClose={() => setPicking(null)} />
      <SettleForm s={settling} today={today} onClose={() => setSettling(null)} />
    </>
  );
}

function SplitCard({
  v, open, onToggle, onEdit, onAdd, onPick, onSettle,
}: {
  v: SplitView; open: boolean; today: string; onToggle: () => void; onEdit: () => void; onAdd: () => void;
  onPick: () => void; onSettle: (t: Transfer) => void;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, start] = useTransition();
  const [allRows, setAllRows] = useState(false);
  const { split, people } = v;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) { notify('error', res.error ?? 'That did not work.'); return; }
      if (done) notify('success', done);
      router.refresh();
    });

  const rows = allRows ? v.rows : v.rows.slice(0, 8);

  return (
    <Panel padded={false}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{split.name}</div>
          <div className="text-xs text-[var(--color-ink-3)]">
            {formatDayShort(split.day).split(',')[0]} · You, {split.people.map((p) => p.name).join(', ')} · <Money value={v.total} size="sm" tone="muted" />
            {v.recovered > 0.5 ? <> · got back <Money value={v.recovered} size="sm" tone="muted" /></> : null}
            {v.lost > 0.5 ? <> · lost <Money value={v.lost} size="sm" tone="muted" /></> : null}
          </div>
        </div>
        <Stand v={v.mine} className="shrink-0" />
        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-[var(--color-ink-3)]" /> : <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-ink-3)]" />}
      </button>

      {open ? (
        <div className="border-t border-[var(--color-line)] px-4 pb-4 pt-3 sm:px-5">
          {/* Who pays whom — what this page is opened for. */}
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">To settle up</h3>
          {v.transfers.length === 0 ? (
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">{v.rows.length ? 'Everyone is settled.' : 'Nothing spent yet.'}</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {v.transfers.map((t) => (
                <li key={`${t.from}-${t.to}`} className="flex items-center gap-2 rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2 text-sm">
                  <span className={cn('font-medium', t.from === ME && 'text-[var(--color-neg)]')}>{nameOf(people, t.from)}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-[var(--color-ink-3)]" aria-hidden="true" />
                  <span className={cn('min-w-0 flex-1 truncate font-medium', t.to === ME && 'text-[var(--color-pos)]')}>{nameOf(people, t.to)}</span>
                  <Money value={t.amount} size="sm" className="font-semibold" />
                  <Button size="sm" variant="secondary" disabled={pending} className="h-7 px-2"
                    aria-label={`Settle ${nameOf(people, t.from)} to ${nameOf(people, t.to)}`}
                    onClick={() => onSettle(t)}>
                    <Check className="h-3.5 w-3.5" aria-hidden="true" /> Settle
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Each person: what they paid against their share. */}
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-1 text-xs">
            <span className="text-[var(--color-ink-3)]">Person</span>
            <span className="text-right text-[var(--color-ink-3)]">Paid</span>
            <span className="text-right text-[var(--color-ink-3)]">Share</span>
            {v.balances.map((b) => (
              <div key={b.person} className="contents">
                <span className="truncate">{nameOf(people, b.person)}</span>
                <span className="text-right"><Money value={b.paid} size="sm" /></span>
                <span className="text-right"><Money value={b.share} size="sm" tone="muted" /></span>
              </div>
            ))}
          </div>

          {/* What was spent. */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
              Spent ({v.rows.length}){split.match.length ? <span className="normal-case tracking-normal"> · yours found by “{split.match.join('”, “')}”</span> : null}
            </h3>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="secondary" onClick={onPick}><ListPlus className="h-3.5 w-3.5" aria-hidden="true" /> My entries</Button>
              <Button size="sm" onClick={onAdd}><Plus className="h-3.5 w-3.5" aria-hidden="true" /> Friend paid</Button>
            </div>
          </div>
          {v.rows.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--color-ink-3)]">“My entries” picks what you paid (your Credit Given entries); “Friend paid” adds what a friend paid.</p>
          ) : (
            <ul className="mt-1 flex flex-col">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 border-b border-[var(--color-line)] py-1.5 text-xs last:border-b-0">
                  <span className="w-12 shrink-0 text-[var(--color-ink-3)]">{formatDayShort(r.day).split(',')[0]}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{nameOf(people, r.payer)}</span>
                    {r.note ? <span className="text-[var(--color-ink-3)]"> · {r.note}</span> : null}
                    {r.among.length < people.length ? <span className="text-[var(--color-ink-3)]"> · for {r.among.map((p) => nameOf(people, p)).join(', ')}</span> : null}
                  </span>
                  <Money value={r.amount} size="sm" />
                  {r.from === 'ledger' ? (
                    <button type="button" disabled={pending} title="Not part of this split — leave it out"
                      aria-label={`Leave ${r.note || 'this entry'} out`} className="text-[var(--color-ink-3)] hover:text-[var(--color-neg)]"
                      onClick={() => run(() => excludeFromSplitAction({ split: split.id, tx: r.id, out: true }), 'Left out.')}>
                      <MinusCircle className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : (
                    <button type="button" disabled={pending} aria-label={`Delete ${r.note || 'this expense'}`}
                      className="text-[var(--color-ink-3)] hover:text-[var(--color-neg)]"
                      onClick={() => run(() => deleteSplitExpenseAction({ split: split.id, id: r.id }))}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {v.rows.length > 8 ? (
            <button type="button" onClick={() => setAllRows((a) => !a)} className="mt-1 text-xs font-medium text-[var(--color-accent)]">
              {allRows ? 'Show fewer' : `Show all ${v.rows.length}`}
            </button>
          ) : null}

          {split.settlements.length ? (
            <div className="mt-4">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">Settled</h3>
              <ul className="mt-1 flex flex-col">
                {split.settlements.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-1 text-xs">
                    <span className="w-12 shrink-0 text-[var(--color-ink-3)]">{formatDayShort(s.day).split(',')[0]}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {s.kind === 'writeoff'
                        ? <><span className="text-[var(--color-neg)]">Written off</span> · {nameOf(people, s.from)} never paid</>
                        : <>{nameOf(people, s.from)} paid {nameOf(people, s.to)}</>}
                    </span>
                    <Money value={s.amount} size="sm" />
                    <button type="button" disabled={pending} aria-label="Undo this payment" title="Undo"
                      className="text-[var(--color-ink-3)] hover:text-[var(--color-neg)]"
                      onClick={() => run(() => deleteSettlementAction({ split: split.id, id: s.id }))}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[var(--color-line)] pt-3">
            {split.exclude?.length ? (
              <Button size="sm" variant="ghost" disabled={pending}
                onClick={() => split.exclude!.forEach((tx) => run(() => excludeFromSplitAction({ split: split.id, tx, out: false })))}>
                Put back {split.exclude.length} left out
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onEdit}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit</Button>
            <Button size="sm" variant="ghost" disabled={pending}
              onClick={() => { if (window.confirm(`Delete “${split.name}”? Your own entries are not touched.`)) run(() => deleteSplitAction({ id: split.id }), 'Deleted.'); }}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
            </Button>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

/* --- A split: name, friends, the tag that finds your entries -------------- */

function SplitForm({
  split, tags, today, onClose, onSaved,
}: { split: Split | 'new' | null; tags: string[]; today: string; onClose: () => void; onSaved: (id: string) => void }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, start] = useTransition();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [day, setDay] = useState(today);
  const [friends, setFriends] = useState<SplitPerson[]>([]);
  const [friend, setFriend] = useState('');
  const [match, setMatch] = useState<string[]>([]);
  const [words, setWords] = useState('');
  const [openFor, setOpenFor] = useState<string | null>(null);

  const key = split === 'new' ? 'new' : split?.id ?? null;
  if (key !== openFor) {
    setOpenFor(key);
    if (split === 'new') {
      setId(`sp-${crypto.randomUUID()}`); setName(''); setDay(today); setFriends([]); setMatch([]); setWords(''); setFriend('');
    } else if (split) {
      setId(split.id); setName(split.name); setDay(split.day); setFriends(split.people);
      setMatch(split.match.filter((m) => tags.includes(m)));
      setWords(split.match.filter((m) => !tags.includes(m)).join(', '));
      setFriend('');
    }
  }

  const addFriend = () => {
    const n = friend.trim();
    if (!n) return;
    setFriends((f) => [...f, { id: `p-${crypto.randomUUID().slice(0, 8)}`, name: n }]);
    setFriend('');
  };

  function save(e: React.FormEvent) {
    e.preventDefault();
    const pending = friend.trim() ? [...friends, { id: `p-${crypto.randomUUID().slice(0, 8)}`, name: friend.trim() }] : friends;
    const all = [...match, ...words.split(',').map((w) => w.trim()).filter(Boolean)];
    start(async () => {
      const res = await saveSplitAction({ id, name, day, friends: pending, match: all });
      if (!res.ok) { notify('error', res.error); return; }
      onSaved(id);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={split !== null}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={split === 'new' ? 'New split' : 'Edit split'}
      description="A trip or a meal out. Each expense is shared equally among the people it was for."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" form="split-form" pending={pending}>Save</Button>
        </>
      }
    >
      <form id="split-form" onSubmit={save} className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          <Field label="Name" htmlFor="sp-name" className="min-w-0 flex-1 basis-48">
            <input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Wayanad trip, Friday dinner…" className={inputClass()} />
          </Field>
          <Field label="Day" htmlFor="sp-day" className="w-40">
            <input id="sp-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputClass()} />
          </Field>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-2)]">Friends (you are in it already)</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {friends.map((f) => (
              <span key={f.id} className="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--color-line)] pl-3 pr-1 text-xs">
                {f.name}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFriends((fs) => fs.filter((x) => x.id !== f.id))}
                  className="rounded-full p-1 text-[var(--color-ink-3)] hover:text-[var(--color-neg)]">
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            <input value={friend} onChange={(e) => setFriend(e.target.value)} placeholder="Add a name"
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addFriend(); } }}
              aria-label="Friend’s name" className={cn(inputClass(), 'h-8 w-36 text-xs')} />
            <Button size="sm" variant="secondary" onClick={addFriend} className="h-8">Add</Button>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-2)]">Your entries for it carry the tag</p>
          {tags.length ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <Chip key={t} on={match.includes(t)} onClick={() => setMatch((m) => (m.includes(t) ? m.filter((x) => x !== t) : [...m, t]))}>{t}</Chip>
              ))}
            </div>
          ) : null}
          <input value={words} onChange={(e) => setWords(e.target.value)} placeholder="…or words in their description, e.g. wayanad"
            aria-label="Words that find your entries" className={cn(inputClass(), 'mt-2 text-xs')} />
          <p className="mt-1 text-[11px] text-[var(--color-ink-3)]">Optional. Your matching entries count as paid by you; you can leave any one out later.</p>
        </div>
      </form>
    </Dialog>
  );
}

/* --- An expense: who paid, how much, for whom ----------------------------- */

function ExpenseForm({ v, today, onClose }: { v: SplitView | null; today: string; onClose: () => void }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, start] = useTransition();
  const [payer, setPayer] = useState('');
  const [amount, setAmount] = useState('');
  const [among, setAmong] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [day, setDay] = useState(today);
  const [clientKey, setClientKey] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openFor, setOpenFor] = useState<string | null>(null);

  const key = v?.split.id ?? null;
  if (key !== openFor) {
    setOpenFor(key);
    if (v) {
      setPayer(v.split.people[0]?.id ?? ME); setAmount(''); setAmong(v.people.map((p) => p.id));
      setNote(''); setDay(today); setClientKey(crypto.randomUUID()); setErrors({});
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!v) return;
    start(async () => {
      const res = await addSplitExpenseAction({ split: v.split.id, payer, amount: amountToSubmit(amount), day, note, among, clientKey });
      if (!res.ok) { setErrors(res.fieldErrors ?? {}); notify('error', res.error); return; }
      onClose();
      router.refresh();
    });
  }

  const people = v?.people ?? [];
  return (
    <Dialog
      open={v !== null}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={v ? `Add to ${v.split.name}` : ''}
      description="Usually what a friend paid. What you paid with your own money comes from your entries."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="submit" form="split-expense" pending={pending}>Add</Button>
        </>
      }
    >
      <form id="split-expense" onSubmit={save} className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-2)]">Paid by</p>
          <div role="radiogroup" aria-label="Paid by" className="flex flex-wrap gap-1.5">
            {people.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={payer === p.id} onClick={() => setPayer(p.id)}
                className={cn('h-8 rounded-full border px-3 text-xs',
                  payer === p.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-ink)]' : 'border-[var(--color-line)] text-[var(--color-ink-2)]')}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
        <Field label="Amount" htmlFor="se-amount" error={errors['amount']}>
          <AmountField id="se-amount" value={amount} onChange={setAmount} error={errors['amount']} autoFocus />
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-medium text-[var(--color-ink-2)]">Shared by</p>
          <div className="flex flex-wrap gap-1.5">
            {people.map((p) => (
              <Chip key={p.id} on={among.includes(p.id)} onClick={() => setAmong((a) => (a.includes(p.id) ? a.filter((x) => x !== p.id) : [...a, p.id]))}>{p.name}</Chip>
            ))}
          </div>
          {errors['among'] ? <p className="mt-1 text-xs text-[var(--color-neg)]">{errors['among']}</p> : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Field label="What for (optional)" htmlFor="se-note" className="min-w-0 flex-1 basis-40">
            <input id="se-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Room, dinner, fuel…" className={inputClass()} />
          </Field>
          <Field label="Day" htmlFor="se-day" error={errors['day']} className="w-40">
            <input id="se-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputClass(errors['day'])} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}

/* --- Settling one payment: received, or written off ----------------------- */

function SettleForm({ s, today, onClose }: { s: { v: SplitView; t: Transfer } | null; today: string; onClose: () => void }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(today);
  const [clientKey, setClientKey] = useState('');
  const [openFor, setOpenFor] = useState<string | null>(null);

  const key = s ? `${s.v.split.id}:${s.t.from}:${s.t.to}:${s.t.amount}` : null;
  if (key !== openFor) {
    setOpenFor(key);
    if (s) { setAmount(s.t.amount.toFixed(2)); setDay(today); setClientKey(crypto.randomUUID()); }
  }

  const people = s?.v.people ?? [];
  const toMe = s?.t.to === ME;

  const save = (kind: 'paid' | 'writeoff') => {
    if (!s) return;
    start(async () => {
      const res = await settleSplitAction({
        split: s.v.split.id, from: s.t.from, to: s.t.to, amount: amountToSubmit(amount), day, clientKey, kind,
      });
      if (!res.ok) { notify('error', res.error); return; }
      notify('success', kind === 'writeoff' ? 'Written off.' : 'Settled.');
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog
      open={s !== null}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={s ? `${nameOf(people, s.t.from)} → ${nameOf(people, s.t.to)}` : ''}
      description={toMe
        ? 'Received: they paid you back (change the amount if it was part). Write off: it is not coming back — counted as your loss.'
        : 'Record that this was paid. Change the amount if it was only part.'}
      footer={
        <>
          {toMe ? <Button variant="secondary" disabled={pending} onClick={() => save('writeoff')}>Write off</Button> : null}
          <Button pending={pending} onClick={() => save('paid')}>
            <Check className="h-4 w-4" aria-hidden="true" /> {toMe ? 'Received' : 'Paid'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Amount" htmlFor="st-amount">
          <AmountField id="st-amount" value={amount} onChange={setAmount} />
        </Field>
        <Field label="Day" htmlFor="st-day">
          <input id="st-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputClass()} />
        </Field>
      </div>
    </Dialog>
  );
}

/* --- Picking your own entries in — usually Credit Given ------------------- */

function PickEntries({ v, candidates, onClose }: { v: SplitView | null; candidates: Candidate[]; onClose: () => void }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [openFor, setOpenFor] = useState<string | null>(null);

  const key = v?.split.id ?? null;
  if (key !== openFor) { setOpenFor(key); setChosen([]); setQ(''); }

  const needle = q.trim().toLowerCase();
  const shown = needle ? candidates.filter((c) => c.remarks.toLowerCase().includes(needle) || String(c.amount).includes(needle)) : candidates;
  const sum = candidates.filter((c) => chosen.includes(c.id)).reduce((a, c) => a + c.amount, 0);

  const save = () => {
    if (!v || chosen.length === 0) return;
    start(async () => {
      const res = await includeInSplitAction({ split: v.split.id, txs: chosen });
      if (!res.ok) { notify('error', res.error); return; }
      notify('success', `${chosen.length} added to ${v.split.name} as paid by you.`);
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog
      open={v !== null}
      onOpenChange={(o) => !o && !pending && onClose()}
      title={v ? `Your entries for ${v.split.name}` : ''}
      description="Your Credit Given entries from the last six months that are not in a split yet. Each one picked counts as paid by you, shared by everyone."
      footer={
        <>
          <span className="mr-auto self-center text-xs text-[var(--color-ink-3)]">
            {chosen.length ? <>{chosen.length} picked · <Money value={sum} size="sm" /></> : 'None picked'}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} pending={pending} disabled={chosen.length === 0}>Add</Button>
        </>
      }
    >
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-ink-3)]" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find — dinner, wayanad, 450…" aria-label="Find an entry"
          className={cn(inputClass(), 'pl-8 text-sm')} />
      </label>
      {shown.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-ink-3)]">{candidates.length ? 'Nothing matches.' : 'No Credit Given entries left to add.'}</p>
      ) : (
        <ul className="mt-2 flex max-h-[50dvh] flex-col overflow-y-auto">
          {shown.map((c) => {
            const on = chosen.includes(c.id);
            return (
              <li key={c.id}>
                <label className={cn('flex cursor-pointer items-center gap-3 rounded-[var(--radius-field)] px-2 py-2 text-xs', on && 'bg-[var(--color-accent-soft)]')}>
                  <input type="checkbox" checked={on} className="h-4 w-4 accent-[var(--color-accent)]"
                    onChange={() => setChosen((x) => (on ? x.filter((y) => y !== c.id) : [...x, c.id]))} />
                  <span className="w-12 shrink-0 text-[var(--color-ink-3)]">{formatDayShort(c.day).split(',')[0]}</span>
                  <span className="min-w-0 flex-1 truncate">{c.remarks || 'Credit Given'}<span className="text-[var(--color-ink-3)]"> · {c.method}</span></span>
                  <Money value={c.amount} size="sm" />
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
