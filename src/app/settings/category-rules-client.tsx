'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import type { CategoryRule } from '@/lib/category-rules';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/ui/toast';
import { saveCategoryRulesAction } from './actions';

/* ===========================================================================
   "A name containing these words is this category" — the owner's rules for
   payments a photo cannot explain (lib/category-rules).

   Edited as a whole list and saved in one go, like the bank mapping: removing
   a line is as much an edit as adding one. Saving fills any photo entry still
   waiting for a category that a rule now covers.
   =========================================================================== */

type Line = { id: string; words: string; category: string; description: string };

export function CategoryRuleSettings({
  rules, categories,
}: {
  rules: CategoryRule[];
  categories: readonly string[];
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<Line[]>(rules.map((r, i) => ({ id: `r${i}`, words: r.words, category: r.category, description: r.description ?? '' })));

  const set = (id: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  function save() {
    const out = lines
      .map((l) => ({ words: l.words.trim(), category: l.category, ...(l.description.trim() ? { description: l.description.trim() } : {}) }))
      .filter((l) => l.words && l.category);
    startTransition(async () => {
      const result = await saveCategoryRulesAction({ rules: out });
      if (!result.ok) { notify('error', result.error); return; }
      const { saved, filled } = result.data;
      notify('success', `${saved} ${saved === 1 ? 'rule' : 'rules'} saved${filled ? ` · ${filled} waiting ${filled === 1 ? 'entry' : 'entries'} filled` : ''}.`);
      router.refresh();
    });
  }

  return (
    <>
      {lines.length === 0 ? (
        <p className="py-2 text-xs text-[var(--color-ink-3)]">No rules yet. Add one here, or tick &ldquo;Always&rdquo; when choosing a category for an entry from a photo.</p>
      ) : null}
      <ul className="flex flex-col">
        {lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 last:border-b-0">
            <input
              value={l.words}
              onChange={(e) => set(l.id, { words: e.target.value })}
              placeholder="bakery, or Usman P P"
              aria-label="Words to look for in the name"
              className={cn(inputClass(), 'min-w-0 flex-1 basis-40 text-xs')}
            />
            <span className="shrink-0 text-xs text-[var(--color-ink-3)]">&rarr;</span>
            <select
              value={l.category}
              onChange={(e) => set(l.id, { category: e.target.value })}
              aria-label={`Category for ${l.words || 'these words'}`}
              className={cn(inputClass(), 'w-40 shrink-0 text-xs')}
            >
              <option value="">Choose&hellip;</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              value={l.description}
              onChange={(e) => set(l.id, { description: e.target.value })}
              placeholder="Call it (optional)"
              maxLength={80}
              aria-label={`Description for ${l.words || 'these words'}`}
              className={cn(inputClass(), 'w-40 shrink-0 text-xs')}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove the rule for ${l.words || 'these words'}`}
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
          onClick={() => setLines((ls) => [...ls, { id: `n${Date.now()}`, words: '', category: '', description: '' }])}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add a rule
        </Button>
        <Button size="sm" onClick={save} pending={pending}>Save the rules</Button>
      </div>
    </>
  );
}
