'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import type { BankMethods } from '@/lib/bank-methods';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/field';
import { cx } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { saveBankMethodsAction } from './actions';

/* ===========================================================================
   Teaching the importer what a bank calls each account.

   Edited as a whole list and saved in one go, because removing a line is as
   much an edit as adding one and a row-by-row save could never express a
   deletion.

   THE LABEL MUST BE THE ONE THE BANK PRINTS, including the account digits.
   Three of these are Federal accounts pointing at three different methods, so
   "Federal" on its own is unanswerable — the importer says so rather than
   choosing, because a wrong method moves money onto the wrong card and
   nothing afterwards looks wrong.
   =========================================================================== */

type Line = { id: string; label: string; method: string };

export function BankMethodSettings({
  mapping, methods,
}: {
  mapping: BankMethods;
  methods: string[];
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<Line[]>(
    Object.entries(mapping).map(([label, method], i) => ({ id: `l${i}`, label, method })),
  );

  const set = (id: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  function save() {
    const out: Record<string, string> = {};
    for (const l of lines) {
      const label = l.label.trim();
      if (!label || !l.method) continue;
      out[label] = l.method;
    }
    startTransition(async () => {
      const result = await saveBankMethodsAction({ mapping: out });
      if (!result.ok) { notify('error', result.error); return; }
      notify('success', `${Object.keys(out).length} mappings saved.`);
      router.refresh();
    });
  }

  return (
    <>
      <ul className="flex flex-col">
        {lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 last:border-b-0">
            <input
              value={l.label}
              onChange={(e) => set(l.id, { label: e.target.value })}
              placeholder="Federal 2788"
              aria-label="Bank label as printed"
              className={cx(inputClass(), 'min-w-0 flex-1 basis-40 font-mono text-xs')}
            />
            <span className="shrink-0 text-xs text-[var(--color-ink-3)]">&rarr;</span>
            <select
              value={l.method}
              onChange={(e) => set(l.id, { method: e.target.value })}
              aria-label={`Account for ${l.label || 'this bank label'}`}
              className={cx(inputClass(), 'w-36 shrink-0 text-xs')}
            >
              <option value="">Choose&hellip;</option>
              {methods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove the mapping for ${l.label || 'this bank label'}`}
              onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setLines((ls) => [...ls, { id: `n${Date.now()}`, label: '', method: '' }])}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add a bank
        </Button>
        <Button size="sm" onClick={save} pending={pending}>Save the mapping</Button>
      </div>
    </>
  );
}
