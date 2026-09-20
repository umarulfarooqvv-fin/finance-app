'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { FieldErrors } from '@/lib/action-result';
import { ALL_CATEGORIES, ALL_METHODS, isCard } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, inputClass } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { VoiceInput } from '@/components/entry/voice-input';
import { RemarkSearch } from '@/components/entry/remark-search';
import { AmountField, amountToSubmit } from '@/components/entry/amount-field';
import { createTransactionAction, updateTransactionAction } from './actions';

/* ===========================================================================
   The entry form — add and edit.

   Three things this is built to get right:

   1. NO DOUBLE ENTRY. A fresh idempotency key is minted once per dialog
      opening, not per submit. Pressing Save twice sends the same key, so the
      server resolves both to one row. The disabled button is the courtesy;
      the key is the guarantee.

   2. NO OPTIMISTIC MONEY. The row is not shown as saved until the server
      confirms. Optimism is fine for a toggle that can be reverted, but a
      balance that briefly shows a transaction which then failed to save is
      worse than a spinner.

   3. ERRORS LAND ON THE FIELD THAT CAUSED THEM. The server returns field-level
      errors and they are rendered next to their inputs, so "that is not a real
      date" appears under the date rather than as a banner.
   =========================================================================== */

export type EditableTransaction = {
  id: string;
  ts: string;
  amount: number;
  method: string;
  category: string;
  remarks: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent = create. Present = edit that row. */
  editing?: EditableTransaction | null;
  /** IST "now", supplied by the server so a wrong device clock cannot date an entry. */
  defaultTs: string;
  /**
   * A part-filled create, from somewhere that already knows some of the answer
   * — reconciling a statement knows the date, the amount and the card.
   *
   * It is a DRAFT, not a save: it lands in the fields and waits to be read.
   * A field it leaves out stays empty, so the form goes on refusing to submit
   * until a person supplies it. That is what keeps a suggested category a
   * suggestion.
   */
  draft?: Partial<Omit<EditableTransaction, 'id'>> | null;
  /** The saved row's id, when a create produced one. The capture inbox uses
      it to link a photo to the entry it became. */
  onSaved?: (id?: string) => void;
};

const blank = (ts: string) => ({ amount: '', method: '', category: '', remarks: '', ts });

/** A draft's set fields, as form strings. Nulls and undefineds are dropped so
    they cannot overwrite a blank with `undefined` and break the inputs. */
function clean(draft: Props['draft']): Partial<ReturnType<typeof blank>> {
  if (!draft) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft)) {
    if (v !== null && v !== undefined && v !== '') out[k] = String(v);
  }
  return out;
}

export function TransactionDialog({ open, onOpenChange, editing, defaultTs, draft, onSaved }: Props) {
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState(() => blank(defaultTs));

  /* Fields the voice parser was unsure about. Highlighted rather than
     silently accepted: a misheard payment method moves debt onto the wrong
     card, which is the hardest error to spot weeks later. */
  const [uncertain, setUncertain] = useState<string[]>([]);
  const [heardAs, setHeardAs] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  // One key per opening of the dialog. Re-submitting after a network error
  // reuses it, so a request that actually succeeded cannot become two rows.
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID());

  /* The draft is read through a ref, and `draft` is deliberately NOT a
     dependency of the effect below. A caller passing an inline object literal
     — which is the natural way to write one — would otherwise hand over a new
     identity on every render, and the form would reset itself under the
     fingers of whoever was typing into it. The draft only ever matters at the
     moment the dialog opens, which `open` already captures. */
  const latestDraft = useRef(draft);
  latestDraft.current = draft;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setUncertain([]);
    setHeardAs(null);
    setClientKey(crypto.randomUUID());
    setForm(
      editing
        ? {
            amount: String(editing.amount),
            method: editing.method,
            category: editing.category,
            remarks: editing.remarks,
            ts: editing.ts,
          }
        : { ...blank(defaultTs), ...clean(latestDraft.current) },
    );
  }, [open, editing, defaultTs]);

  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    // Touching a field is the user vouching for it, so the warning goes.
    setUncertain((u) => u.filter((x) => x !== k));
  };

  /* A transcript becomes a DRAFT, never a row. Fields the parser could not
     determine are left blank rather than guessed, so the form still refuses
     to submit until they are filled in. */
  async function handleTranscript(transcript: string) {
    setParsing(true);
    setHeardAs(null);
    try {
      const res = await fetch('/api/parse-entry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const json = (await res.json()) as
        | { ok: true; draft: { amount: string | null; method: string | null; category: string | null; remarks: string; uncertain: string[]; source: string } }
        | { ok: false; error: string };

      if (!json.ok) { notify('error', json.error); return; }

      const d = json.draft;
      setForm((f) => ({
        ...f,
        amount: d.amount ?? f.amount,
        method: d.method ?? f.method,
        category: d.category ?? f.category,
        remarks: d.remarks || f.remarks,
      }));
      setUncertain(d.uncertain);
      setHeardAs(`${transcript} — read by the ${d.source}`);

      if (d.uncertain.length) {
        notify('error', `Check the highlighted ${d.uncertain.join(' and ')} before saving.`);
      }
    } catch {
      notify('error', 'Could not parse that. Type the entry instead.');
    } finally {
      setParsing(false);
    }
  }

  const flagged = (field: string) => (uncertain.includes(field) ? 'Heard, but not certain — please check.' : undefined);

  // Paying a card bill reads differently from spending on one, so the form
  // says which it is rather than leaving the user to infer it.
  const meaning = useMemo(() => {
    const { method, category } = form;
    if (!method || !category) return null;
    if (isCard(category)) return `Paying the ${category} bill from ${method}.`;
    if (category === 'Credit Given') return `Lending money, paid by ${method}.`;
    if (isCard(method)) return `Spending on ${method} — this adds to that card's balance.`;
    return `Spending from ${method}.`;
  }, [form]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    /* The box may hold "450+230+120"; the ledger stores 800. Converted once,
       here, so both the create and the edit path send the same thing and
       neither can drift into saving an expression as text. */
    const payload = { ...form, amount: amountToSubmit(form.amount) };

    startTransition(async () => {
      let savedId: string | undefined;

      // Kept as two branches rather than one ternary: only a create can come
      // back reporting that it resolved to an existing row, and the compiler
      // should enforce that rather than the reader remembering it.
      if (editing) {
        const result = await updateTransactionAction({ ...payload, id: editing.id });
        if (!result.ok) {
          if (result.fieldErrors) setErrors(result.fieldErrors);
          notify('error', result.error);
          return;
        }
        notify('success', 'Entry updated.');
      } else {
        const result = await createTransactionAction({ ...payload, clientKey });
        if (!result.ok) {
          if (result.fieldErrors) setErrors(result.fieldErrors);
          notify('error', result.error);
          return;
        }
        // A retry that landed on a row already written says so plainly,
        // rather than implying a second entry was created.
        notify(
          'success',
          result.data.duplicate ? 'Already saved — no duplicate was created.' : 'Entry saved.',
        );
        savedId = result.data.id;
      }

      onOpenChange(false);
      onSaved?.(savedId);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit entry' : 'New entry'}
      description={
        editing
          ? 'Changing an entry clears its verified tick — it is no longer the row you reconciled.'
          : undefined
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
        {!editing ? (
          <VoiceInput onTranscript={handleTranscript} parsing={parsing} disabled={pending} />
        ) : null}

        {heardAs ? (
          <p className="rounded-[var(--radius-field)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-2 text-[11px] text-[var(--color-ink-2)]">
            Heard: {heardAs}
          </p>
        ) : null}

        <Field
          label="Amount"
          htmlFor="amount"
          error={errors['amount'] ?? flagged('amount')}
          hint="Rupees, to the paisa — or a sum like 450+230"
        >
          <AmountField
            value={form.amount}
            onChange={set('amount')}
            error={errors['amount']}
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid from" htmlFor="method" error={errors['method'] ?? flagged('method')}>
            <select
              id="method"
              name="method"
              value={form.method}
              onChange={(e) => set('method')(e.target.value)}
              aria-invalid={Boolean(errors['method'])}
              className={inputClass(errors['method'])}
            >
              <option value="">Choose…</option>
              {ALL_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>

          <Field label="Category" htmlFor="category" error={errors['category'] ?? flagged('category')}>
            <select
              id="category"
              name="category"
              value={form.category}
              onChange={(e) => set('category')(e.target.value)}
              aria-invalid={Boolean(errors['category'])}
              className={inputClass(errors['category'])}
            >
              <option value="">Choose…</option>
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{isCard(c) ? `${c} (bill payment)` : c}</option>
              ))}
            </select>
          </Field>
        </div>

        {meaning ? (
          <p className="rounded-[var(--radius-field)] bg-[var(--color-raised)] px-3 py-2 text-[11px] text-[var(--color-ink-2)]">
            {meaning}
          </p>
        ) : null}

        <Field label="Date and time" htmlFor="ts" error={errors['ts']}>
          <input
            id="ts"
            name="ts"
            type="datetime-local"
            step="1"
            value={form.ts}
            onChange={(e) => set('ts')(e.target.value.length === 16 ? `${e.target.value}:00` : e.target.value)}
            aria-invalid={Boolean(errors['ts'])}
            className={inputClass(errors['ts'])}
          />
        </Field>

        <Field
          label="Remarks"
          htmlFor="remarks"
          error={errors['remarks']}
          hint="Optional — search what you have used before"
        >
          <RemarkSearch
            id="remarks"
            value={form.remarks}
            error={errors['remarks']}
            onChange={set('remarks')}
            /* A picked remark brings its category, but ONLY into an empty
               field. A category already chosen — by hand, by the voice parser,
               or by the statement draft this dialog was opened from — is an
               answer someone gave; a past entry's filing is a suggestion, and
               a suggestion does not overwrite an answer. */
            onPick={({ remarks, category }) => {
              setForm((f) => ({ ...f, remarks, category: f.category || category }));
              // Picking is vouching, the same as typing into the field.
              setUncertain((u) => u.filter((x) => x !== 'remarks' && x !== 'category'));
            }}
          />
        </Field>

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" pending={pending}>
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Add entry'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
