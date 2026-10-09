'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lightbulb, Pencil, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { inputClass } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Badge, Empty, Money, Panel, SectionTitle } from '@/components/ui/primitives';
import { formatDay } from '@/lib/time';
import { normaliseTag } from '@/lib/user-tags';
import type { LabelSuggestion, TagSummary } from '@/lib/tag-summary';
import { deleteTagAction, labelToTagAction, renameTagAction } from './actions';

type Pending =
  | { kind: 'rename'; tag: string }
  | { kind: 'delete'; tag: string }
  | { kind: 'convert'; label: string; count: number }
  | null;

const span = (a: string | null, b: string | null) =>
  !a ? '' : a === b ? formatDay(a) : `${formatDay(a)} – ${formatDay(b!)}`;

export function TagsClient({ tags, suggestions }: { tags: TagSummary[]; suggestions: LabelSuggestion[] }) {
  const router = useRouter();
  const { notify } = useToast();
  const [busy, startTransition] = useTransition();
  const [pending, setPending] = useState<Pending>(null);
  const [name, setName] = useState('');

  const open = (p: NonNullable<Pending>) => {
    setPending(p);
    setName(p.kind === 'rename' ? p.tag : p.kind === 'convert' ? p.label : '');
  };

  function run() {
    if (!pending) return;
    startTransition(async () => {
      const r = pending.kind === 'rename'
        ? await renameTagAction({ from: pending.tag, to: name })
        : pending.kind === 'delete'
          ? await deleteTagAction({ tag: pending.tag })
          : await labelToTagAction({ label: pending.label, tag: name });
      if (!r.ok) { notify('error', r.fieldErrors ? Object.values(r.fieldErrors)[0] ?? r.error : r.error); return; }
      const n = r.data.changed;
      const entries = `${n} ${n === 1 ? 'entry' : 'entries'}`;
      notify('success',
        pending.kind === 'rename' ? `Renamed on ${entries}.`
          : pending.kind === 'delete' ? `Tag taken off ${entries}. The entries themselves are unchanged.`
            : `Tagged ${entries} “${normaliseTag(name)}”.`);
      setPending(null);
      router.refresh();
    });
  }

  const real = tags.filter((t) => t.stored > 0);
  const legacy = tags.filter((t) => t.stored === 0);

  return (
    <>
      {suggestions.length > 0 || legacy.length > 0 ? (
        <Panel className="mb-4">
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> From your notes
            </span>
          </SectionTitle>
          <p className="mb-3 text-xs text-[var(--color-ink-2)]">
            Labels you wrote in brackets on several entries, before tags existed. Turning one into a
            tag replaces &ldquo;(Banglore Trip)&rdquo; with the tag on every entry that has it — other
            brackets, like &ldquo;(GST)&rdquo;, are left exactly as they are.
          </p>
          <ul className="flex flex-col">
            {[...legacy.map((t) => ({ label: t.tag, count: t.count, total: t.total })), ...suggestions].map((s) => (
              <li key={s.label} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0">
                <span className="min-w-0 flex-1 truncate">&ldquo;({s.label})&rdquo;</span>
                <span className="text-[11px] text-[var(--color-ink-3)]">
                  {s.count} entries · <Money value={s.total} size="sm" />
                </span>
                <Button size="sm" variant="secondary" onClick={() => open({ kind: 'convert', label: s.label, count: s.count })}>
                  Make it a tag
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {real.length === 0 ? (
        <Panel>
          <Empty
            title="No tags yet"
            hint="Add one from the Tags field when writing an entry, or on Entries choose “Select to tag”. From the Shortcut, end the remarks with [Tag name]."
          />
        </Panel>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {real.map((t) => (
            <Panel key={t.tag}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                  <Tag className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
                  <span className="truncate">{t.tag}</span>
                </h2>
                <span className="flex shrink-0 gap-0.5">
                  <button
                    type="button" aria-label={`Rename ${t.tag}`} title="Rename"
                    onClick={() => open({ kind: 'rename', tag: t.tag })}
                    className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-3)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button" aria-label={`Remove the tag ${t.tag}`} title="Remove the tag"
                    onClick={() => open({ kind: 'delete', tag: t.tag })}
                    className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-3)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">
                {span(t.first, t.last)} · {t.count} {t.count === 1 ? 'entry' : 'entries'}
              </p>

              <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-1">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">Total</div>
                  <Money value={t.total} size="lg" className="font-semibold" />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">Spent</div>
                  <Money value={t.spent} size="sm" />
                </div>
                {t.lent > 0.005 ? (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">Lent</div>
                    <Money value={t.lent} size="sm" tone="debt" />
                  </div>
                ) : null}
              </div>

              <ul className="mt-3 flex flex-col gap-1">
                {t.byCategory.slice(0, 4).map((c) => (
                  <li key={c.category} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-[var(--color-ink-2)]">{c.category}</span>
                    <Badge tone="neutral">&times;{c.count}</Badge>
                    <Money value={c.total} size="sm" />
                  </li>
                ))}
              </ul>

              <Link
                href={`/transactions?tag=${encodeURIComponent(t.tag)}`}
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)]"
              >
                See the {t.count} {t.count === 1 ? 'entry' : 'entries'} <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </Panel>
          ))}
        </div>
      )}

      <Dialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === 'rename' ? 'Rename tag'
          : pending?.kind === 'delete' ? `Remove “${pending.tag}”?`
            : 'Make it a tag'}
        description={pending?.kind === 'rename'
          ? 'Every entry with this tag gets the new name. Renaming onto a tag that already exists merges the two.'
          : pending?.kind === 'delete'
            ? 'The tag is taken off every entry. The entries themselves — amounts, dates, everything else — stay as they are.'
            : pending?.kind === 'convert'
              ? `On ${pending.count} entries, “(${pending.label})” becomes this tag. Rename it here if you like.`
              : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
            <Button
              onClick={run}
              pending={busy}
              disabled={pending?.kind !== 'delete' && !normaliseTag(name)}
            >
              {pending?.kind === 'delete' ? 'Remove the tag' : pending?.kind === 'rename' ? 'Rename' : 'Make it a tag'}
            </Button>
          </>
        }
      >
        {pending && pending.kind !== 'delete' ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && normaliseTag(name)) run(); }}
            aria-label="Tag name"
            autoFocus
            className={inputClass()}
          />
        ) : null}
      </Dialog>
    </>
  );
}
