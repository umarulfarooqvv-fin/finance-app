'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, TriangleAlert } from 'lucide-react';
import type { Account, Card } from '@/lib/types';
import { formatDay } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, inputClass } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Badge, Dot, Money } from '@/components/ui/primitives';
import { saveAccountSettingsAction, saveCardSettingsAction } from './actions';

/* ===========================================================================
   Editing the configuration.

   These are not ordinary form fields. A bill date decides which statement
   every charge on that card has ever belonged to, and an opening balance is
   added to every balance derived from it. So the dialog says what a field
   does in the words of its consequence, and the destructive-looking ones
   carry a warning rather than a tooltip.

   Nothing is saved optimistically. The figures on this screen are the ones
   the rest of the app is computed from, and showing a saved state that the
   server then rejected would be worse here than anywhere else in the app.
   =========================================================================== */

type CardForm = {
  name: string;
  billDate: string;
  dueDay: string;
  dueCycle: string;
  graceDays: string;
  creditLimit: string;
  openingBalance: string;
  openingDate: string;
  statementBoundary: string;
  active: boolean;
};

const cardToForm = (c: Card): CardForm => ({
  name: c.name,
  billDate: String(c.billDate),
  dueDay: c.dueDay === null ? '' : String(c.dueDay),
  dueCycle: c.dueCycle,
  graceDays: String(c.graceDays),
  creditLimit: String(c.creditLimit),
  openingBalance: String(c.openingBalance),
  openingDate: c.openingDate ?? '',
  statementBoundary: c.statementBoundary,
  active: c.active,
});

/* The colour arrives resolved. A Server Component cannot hand a function to a
   Client Component - it is not serialisable - and `cardColor` is a function,
   so the slot is looked up on the server and only the string crosses. */
export type CardWithColor = Card & { color: string };

export function CardSettings({ cards }: { cards: CardWithColor[] }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<CardForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function save() {
    if (!editing) return;
    setErrors({});
    startTransition(async () => {
      const result = await saveCardSettingsAction({
        ...editing,
        dueDay: editing.dueDay === '' ? null : editing.dueDay,
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        notify('error', result.error);
        return;
      }
      setEditing(null);
      notify('success', `${result.data.name} updated. Every figure using it has been recalculated.`);
      router.refresh();
    });
  }

  const set = (k: keyof CardForm, v: string | boolean) =>
    setEditing((f) => (f ? { ...f, [k]: v } : f));

  return (
    <>
      <ul className="flex flex-col">
        {cards.map((c) => (
          <li
            key={c.name}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] py-2.5 last:border-b-0"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
              <Dot color={c.color} />
              <span className="truncate">{c.name}</span>
              {!c.active ? <Badge tone="neutral">inactive</Badge> : null}
              {c.statementBoundary === 'exclusive' ? <Badge tone="neutral">cut before bill date</Badge> : null}
            </span>

            {/* Columns from `lg` up, where the sidebar still leaves room for
                them; a single wrapped line below that, so the card's NAME is
                never the thing that gets truncated. */}
            <span className="hidden w-24 shrink-0 text-xs text-[var(--color-ink-3)] lg:block">
              Bills on <span className="num text-[var(--color-ink-2)]">{c.billDate}</span>
            </span>
            <span className="hidden w-20 shrink-0 text-xs text-[var(--color-ink-3)] lg:block">
              {c.dueDay ? (
                <>Due <span className="num text-[var(--color-ink-2)]">{c.dueDay}</span>{c.dueCycle === 'next' ? '+' : ''}</>
              ) : (
                <>+<span className="num text-[var(--color-ink-2)]">{c.graceDays}</span>d</>
              )}
            </span>
            <span className="hidden w-28 shrink-0 text-right lg:block">
              <Money value={c.creditLimit} size="sm" tone="muted" />
            </span>
            <span className="hidden w-28 shrink-0 text-right lg:block">
              <Money value={c.openingBalance} size="sm" tone="muted" />
            </span>
            <span className="hidden w-28 shrink-0 truncate text-xs text-[var(--color-ink-3)] lg:block">
              {c.openingDate ? formatDay(c.openingDate) : 'All history'}
            </span>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => { setErrors({}); setEditing(cardToForm(c)); }}
              aria-label={`Edit ${c.name} settings`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>

            <span className="flex w-full flex-wrap items-center gap-x-2 text-[11px] text-[var(--color-ink-3)] lg:hidden">
              <span>Bills on <span className="num">{c.billDate}</span></span>
              <span aria-hidden="true">·</span>
              <span>
                {c.dueDay ? <>due <span className="num">{c.dueDay}</span>{c.dueCycle === 'next' ? ' next month' : ''}</> : <>due +<span className="num">{c.graceDays}</span>d</>}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                limit <Money value={c.creditLimit} size="sm" tone="muted" />
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                opening <Money value={c.openingBalance} size="sm" tone="muted" />
              </span>
              <span aria-hidden="true">·</span>
              <span>{c.openingDate ? `from ${formatDay(c.openingDate)}` : 'all history'}</span>
            </span>
          </li>
        ))}
      </ul>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing ? `${editing.name} settings` : ''}
        description="These decide how this card's statements are built, for its whole history."
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>Cancel</Button>
            <Button pending={pending} onClick={save}>Save</Button>
          </>
        }
      >
        {editing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Statement is generated on"
              htmlFor="billDate"
              error={errors['billDate']}
              hint="Day of the month, 1 to 28."
            >
              <input
                id="billDate" inputMode="numeric" value={editing.billDate}
                onChange={(e) => set('billDate', e.target.value)}
                className={`${inputClass(errors['billDate'])} num`}
              />
            </Field>

            <Field
              label="Payment due on"
              htmlFor="dueDay"
              error={errors['dueDay']}
              hint="Leave blank to use grace days instead."
            >
              <input
                id="dueDay" inputMode="numeric" value={editing.dueDay}
                onChange={(e) => set('dueDay', e.target.value)}
                className={`${inputClass(errors['dueDay'])} num`}
              />
            </Field>

            <Field label="Due day falls in" htmlFor="dueCycle" error={errors['dueCycle']}>
              <select
                id="dueCycle" value={editing.dueCycle}
                onChange={(e) => set('dueCycle', e.target.value)}
                className={inputClass(errors['dueCycle'])}
              >
                <option value="same">the same month as the statement</option>
                <option value="next">the following month</option>
              </select>
            </Field>

            <Field
              label="Grace days"
              htmlFor="graceDays"
              error={errors['graceDays']}
              hint="Used only when there is no due day."
            >
              <input
                id="graceDays" inputMode="numeric" value={editing.graceDays}
                onChange={(e) => set('graceDays', e.target.value)}
                className={`${inputClass(errors['graceDays'])} num`}
              />
            </Field>

            <Field label="Credit limit" htmlFor="creditLimit" error={errors['creditLimit']}>
              <input
                id="creditLimit" inputMode="decimal" value={editing.creditLimit}
                onChange={(e) => set('creditLimit', e.target.value)}
                className={`${inputClass(errors['creditLimit'])} num`}
              />
            </Field>

            <Field
              label="Opening balance"
              htmlFor="openingBalance"
              error={errors['openingBalance']}
              hint="Debt already on the card when tracking began."
            >
              <input
                id="openingBalance" inputMode="decimal" value={editing.openingBalance}
                onChange={(e) => set('openingBalance', e.target.value)}
                className={`${inputClass(errors['openingBalance'])} num`}
              />
            </Field>

            <Field
              label="Tracked from"
              htmlFor="openingDate"
              error={errors['openingDate']}
              hint="Rows before this date are skipped, not added."
            >
              <input
                id="openingDate" type="date" value={editing.openingDate}
                onChange={(e) => set('openingDate', e.target.value)}
                className={inputClass(errors['openingDate'])}
              />
            </Field>

            <Field
              label="Spending on the bill date itself"
              htmlFor="statementBoundary"
              error={errors['statementBoundary']}
            >
              <select
                id="statementBoundary" value={editing.statementBoundary}
                onChange={(e) => set('statementBoundary', e.target.value)}
                className={inputClass(errors['statementBoundary'])}
              >
                <option value="inclusive">lands on that statement</option>
                <option value="exclusive">rolls to the next statement</option>
              </select>
            </Field>

            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox" checked={editing.active}
                onChange={(e) => set('active', e.target.checked)}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              Card is in use
            </label>

            <p className="flex items-start gap-2 rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2 text-[11px] text-[var(--color-ink-2)] sm:col-span-2">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
              <span>
                Changing the bill date or the opening balance re-cuts every statement this card has
                ever had. Balances elsewhere in the app will move. The previous values are recorded
                in the audit log.
              </span>
            </p>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

/* --- Accounts ------------------------------------------------------------- */

type AccountForm = { name: string; kind: string; openingBalance: string; since: string; active: boolean };

const accountToForm = (a: Account): AccountForm => ({
  name: a.name,
  kind: a.kind,
  openingBalance: String(a.openingBalance),
  since: a.since ?? '',
  active: a.active,
});

export function AccountSettings({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<AccountForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function save() {
    if (!editing) return;
    setErrors({});
    startTransition(async () => {
      const result = await saveAccountSettingsAction(editing);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        notify('error', result.error);
        return;
      }
      setEditing(null);
      notify('success', `${result.data.name} updated.`);
      router.refresh();
    });
  }

  const set = (k: keyof AccountForm, v: string | boolean) =>
    setEditing((f) => (f ? { ...f, [k]: v } : f));

  return (
    <>
      <ul className="flex flex-col">
        {accounts.map((a) => (
          <li
            key={a.name}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] py-2.5 last:border-b-0"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
              <span className="truncate">{a.name}</span>
              <Badge tone="neutral">{a.kind}</Badge>
              {!a.active ? <Badge tone="neutral">inactive</Badge> : null}
            </span>
            <span className="w-32 shrink-0 text-right">
              <Money value={a.openingBalance} size="sm" tone="muted" />
            </span>
            <span className="w-28 shrink-0 truncate text-xs text-[var(--color-ink-3)]">
              {a.since ? formatDay(a.since) : 'All history'}
            </span>
            <Button
              variant="ghost" size="icon"
              onClick={() => { setErrors({}); setEditing(accountToForm(a)); }}
              aria-label={`Edit ${a.name} settings`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing ? `${editing.name} settings` : ''}
        description="The app has no bank connection. A balance is this opening figure, plus income, minus everything paid out since."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>Cancel</Button>
            <Button pending={pending} onClick={save}>Save</Button>
          </>
        }
      >
        {editing ? (
          <div className="flex flex-col gap-3">
            <Field label="Kind" htmlFor="kind" error={errors['kind']}>
              <select
                id="kind" value={editing.kind}
                onChange={(e) => set('kind', e.target.value)}
                className={inputClass(errors['kind'])}
              >
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
              </select>
            </Field>

            <Field
              label="Opening balance"
              htmlFor="accOpening"
              error={errors['openingBalance']}
              hint="What was in the account on the date below. Negative is allowed."
            >
              <input
                id="accOpening" inputMode="decimal" value={editing.openingBalance}
                onChange={(e) => set('openingBalance', e.target.value)}
                className={`${inputClass(errors['openingBalance'])} num`}
              />
            </Field>

            <Field
              label="Counted from"
              htmlFor="since"
              error={errors['since']}
              hint="Income and outflows before this date are ignored, because the opening balance already includes them."
            >
              <input
                id="since" type="date" value={editing.since}
                onChange={(e) => set('since', e.target.value)}
                className={inputClass(errors['since'])}
              />
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" checked={editing.active}
                onChange={(e) => set('active', e.target.checked)}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              Account is in use
            </label>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
