'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Copy, FileWarning, Trash2 } from 'lucide-react';
import { parseImport, readyToImport, type ImportRow } from '@/lib/import-parse';
import { IMPORT_EXAMPLE, IMPORT_PROMPT } from '@/lib/import-prompt';
import { formatDayShort } from '@/lib/time';
import { Badge, Empty, Money, Panel, SectionTitle, cx } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { importEntriesAction } from './actions';

/* ===========================================================================
   The table between a paste and the ledger.

   NOTHING IMPORTS UNTIL EVERY ROW IS COMPLETE. A method or category the
   assistant could not judge comes through blank, and the Import button stays
   off until those are filled — because a batch of forty rows is exactly where
   a single "Uncategorised" disappears for good.

   THE BULK EDIT IS THE POINT, not a convenience. A day at a hospital is one
   occasion with one wording and half a dozen categories: canteen under Food,
   pharmacy under Medicine, parking under Family. Retyping the wording six
   times is where it becomes six different wordings, and then it can never be
   totalled as one occasion again. So: tick the rows, set the description once.
   =========================================================================== */

type Draft = ImportRow & { key: string; time: string };

export function ImportClient({
  methods, categories, serverNow, entryCount,
}: {
  methods: string[];
  categories: string[];
  serverNow: string;
  entryCount: number;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [pending, startTransition] = useTransition();

  const [text, setText] = useState('');
  const [dateOrder, setDateOrder] = useState<'dmy' | 'mdy'>('dmy');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [skipped, setSkipped] = useState<{ line: number; raw: string; why: string }[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [bulkRemark, setBulkRemark] = useState('');

  function read() {
    const parsed = parseImport(text, { dateOrder });
    /* Noon, like every other date this app writes without a time: an entry at
       00:00 on a bill date sits exactly on the boundary between two
       statements, which is the one timestamp whose cycle depends on a rule. */
    setDrafts(parsed.rows.map((r) => ({ ...r, key: `r${r.line}`, time: '12:00:00' })));
    setSkipped(parsed.skipped);
    setPicked(new Set());
  }

  const rows = drafts ?? [];
  const ready = readyToImport(rows);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const incomplete = rows.filter((r) => !r.method || !r.category).length;

  const set = (key: string, patch: Partial<Draft>) =>
    setDrafts((d) => (d ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const applyToPicked = (patch: Partial<Draft>) => {
    if (picked.size === 0) return;
    setDrafts((d) => (d ?? []).map((r) => (picked.has(r.key) ? { ...r, ...patch } : r)));
  };

  const toggle = (key: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allPicked = rows.length > 0 && picked.size === rows.length;

  /* A key derived from the row's own content, so pressing Import twice — or
     once on a flaky connection — resolves to the same row rather than doubling
     the batch. */
  const keyFor = (r: Draft) =>
    `import:${r.day}:${r.time}:${r.amount}:${r.method}:${r.category}:${r.remarks}`;

  function save() {
    startTransition(async () => {
      const result = await importEntriesAction({
        rows: rows.map((r) => ({
          clientKey: keyFor(r),
          ts: `${r.day}T${r.time}`,
          amount: String(r.amount),
          method: r.method,
          category: r.category,
          remarks: r.remarks,
        })),
      });

      if (!result.ok) { notify('error', result.error); return; }

      const { saved, duplicates, failed } = result.data;
      const parts = [`${saved} saved`];
      if (duplicates > 0) parts.push(`${duplicates} already there`);
      if (failed.length > 0) parts.push(`${failed.length} refused`);
      notify(failed.length > 0 ? 'error' : 'success', parts.join(' · '));

      if (failed.length === 0) {
        setText('');
        setDrafts(null);
        setSkipped([]);
      } else {
        // Keep only what did not land, so a second press cannot double what did.
        const bad = new Set(failed.map((f) => `${f.ts}|${f.remarks}`));
        setDrafts(rows.filter((r) => bad.has(`${r.day}T${r.time}|${r.remarks}`)));
      }
      router.refresh();
    });
  }

  const copyPrompt = () => {
    navigator.clipboard?.writeText(IMPORT_PROMPT).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1800); },
      () => notify('error', 'Could not copy. Select the text instead.'),
    );
  };

  return (
    <>
      {/* ---- The prompt ------------------------------------------------- */}
      <Panel className="mb-4">
        <SectionTitle
          action={
            <Button size="sm" variant="secondary" onClick={copyPrompt}>
              {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-pos)]" aria-hidden="true" />
                      : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy the prompt'}
            </Button>
          }
        >
          Start from screenshots
        </SectionTitle>
        <p className="mb-2 text-xs text-[var(--color-ink-2)]">
          Send this prompt to an assistant along with your UPI screens, bank messages or
          photographed bills, then paste the reply below. It carries this app&rsquo;s own methods
          and categories, so what comes back is already in the right vocabulary.
        </p>
        <details className="rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-canvas)]">
          <summary className="cursor-pointer px-3 py-2 text-xs text-[var(--color-ink-2)]">
            See the prompt and an example
          </summary>
          <div className="border-t border-[var(--color-line)] px-3 py-3">
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-2)]">
              {IMPORT_PROMPT}
            </pre>
            <span className="mt-2 block text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
              What comes back looks like
            </span>
            <pre className="mt-1 overflow-x-auto rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-3)]">
              {IMPORT_EXAMPLE}
            </pre>
          </div>
        </details>
      </Panel>

      {/* ---- The paste --------------------------------------------------- */}
      <Panel className="mb-4">
        <SectionTitle>Paste the rows</SectionTitle>
        <p className="mb-2 text-xs text-[var(--color-ink-2)]">
          One entry per line: <code>date | amount | method | category | description</code>. Tabs and
          aligned columns work too, so a spreadsheet can be pasted straight in. Nothing is saved
          until you have read the table and pressed Import.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          spellCheck={false}
          aria-label="Rows to import"
          placeholder={IMPORT_EXAMPLE}
          className={cx(inputClass(), 'min-h-[8rem] resize-y font-mono text-[11px] leading-relaxed')}
        />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">Date order</span>
            <select
              value={dateOrder}
              onChange={(e) => setDateOrder(e.target.value as 'dmy' | 'mdy')}
              className={inputClass()}
            >
              <option value="dmy">Day first (12/08 = 12 Aug)</option>
              <option value="mdy">Month first (12/08 = 8 Dec)</option>
            </select>
          </label>
          <Button onClick={read} disabled={text.trim() === ''}>Read the rows</Button>
          {drafts ? (
            <Button
              variant="ghost"
              onClick={() => { setText(''); setDrafts(null); setSkipped([]); setPicked(new Set()); }}
            >
              Clear
            </Button>
          ) : null}
          <span className="text-[11px] text-[var(--color-ink-3)]">
            {entryCount.toLocaleString('en-IN')} entries already recorded
          </span>
        </div>
      </Panel>

      {skipped.length > 0 ? (
        <Panel className="mb-4">
          <SectionTitle>
            {skipped.length} {skipped.length === 1 ? 'line' : 'lines'} could not be read
          </SectionTitle>
          <p className="mb-2 text-xs text-[var(--color-ink-2)]">
            Not imported and not counted. Shown so they can be fixed in the paste rather than
            quietly missing from the batch.
          </p>
          <ul className="flex flex-col gap-1">
            {skipped.map((s) => (
              <li key={s.line} className="flex items-start gap-2 text-[11px]">
                <FileWarning className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
                <span className="num shrink-0 text-[var(--color-ink-3)]">line {s.line}</span>
                <code className="min-w-0 flex-1 truncate">{s.raw}</code>
                <span className="shrink-0 text-[var(--color-warn)]">{s.why}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {drafts === null ? null : rows.length === 0 ? (
        <Panel>
          <Empty title="No rows read" hint="Check the format above, or the date order." />
        </Panel>
      ) : (
        <Panel>
          <SectionTitle
            action={
              <Button onClick={save} pending={pending} disabled={!ready}>
                Import {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
              </Button>
            }
          >
            Ready to import &middot; {rows.length}
          </SectionTitle>

          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-[var(--color-ink-2)]">
              Totalling <Money value={total} size="sm" tone="debt" className="font-semibold" />
            </span>
            {incomplete > 0 ? (
              <span className="flex items-center gap-1.5 text-[var(--color-warn)]">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {incomplete} still {incomplete === 1 ? 'needs' : 'need'} a method or category
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[var(--color-pos)]">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Every row is complete
              </span>
            )}
          </div>

          {/* ---- Bulk edit: the reason this page exists ------------------ */}
          {picked.size > 0 ? (
            <div className="mb-3 flex flex-col gap-2 rounded-[var(--radius-field)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-2.5">
              <span className="text-xs text-[var(--color-ink-2)]">
                {picked.size} {picked.size === 1 ? 'row' : 'rows'} selected — set them together.
                One occasion keeps one wording; the categories can still differ.
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={bulkRemark}
                  onChange={(e) => setBulkRemark(e.target.value)}
                  placeholder="Description for all selected"
                  aria-label="Description for all selected rows"
                  className={cx(inputClass(), 'min-w-0 flex-1 text-xs')}
                />
                <Button
                  size="sm"
                  disabled={bulkRemark.trim() === ''}
                  onClick={() => { applyToPicked({ remarks: bulkRemark.trim() }); setBulkRemark(''); }}
                >
                  Set description
                </Button>
                <select
                  value=""
                  aria-label="Set the method for all selected rows"
                  onChange={(e) => e.target.value && applyToPicked({ method: e.target.value })}
                  className={cx(inputClass(), 'w-32 shrink-0 text-xs')}
                >
                  <option value="">Set method…</option>
                  {methods.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select
                  value=""
                  aria-label="Set the category for all selected rows"
                  onChange={(e) => e.target.value && applyToPicked({ category: e.target.value })}
                  className={cx(inputClass(), 'w-36 shrink-0 text-xs')}
                >
                  <option value="">Set category…</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          ) : null}

          <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--color-ink-3)]">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.key)))}
              aria-label="Select every row"
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            Select all
          </div>

          <ul className="flex flex-col">
            {rows.map((r) => {
              const missing = !r.method || !r.category;
              return (
                <li
                  key={r.key}
                  className={cx(
                    'flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0',
                    picked.has(r.key) && 'bg-[var(--color-accent-soft)]',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={picked.has(r.key)}
                    onChange={() => toggle(r.key)}
                    aria-label={`Select ${r.remarks || 'row'} on ${r.day}`}
                    className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span className="num w-20 shrink-0 text-xs text-[var(--color-ink-3)]">
                    {formatDayShort(r.day)}
                  </span>
                  <input
                    value={r.remarks}
                    onChange={(e) => set(r.key, { remarks: e.target.value })}
                    placeholder="What was it for?"
                    aria-label={`Description for the row on ${r.day}`}
                    className={cx(inputClass(), 'min-w-0 flex-1 basis-40 text-xs')}
                  />
                  <select
                    value={r.method}
                    onChange={(e) => set(r.key, { method: e.target.value })}
                    aria-label={`Method for the row on ${r.day}`}
                    className={cx(inputClass(), 'w-28 shrink-0 text-xs', !r.method && 'border-[var(--color-warn)]')}
                  >
                    <option value="">Method…</option>
                    {methods.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select
                    value={r.category}
                    onChange={(e) => set(r.key, { category: e.target.value })}
                    aria-label={`Category for the row on ${r.day}`}
                    className={cx(inputClass(), 'w-32 shrink-0 text-xs', !r.category && 'border-[var(--color-warn)]')}
                  >
                    <option value="">Category…</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <Money value={r.amount} size="sm" tone="debt" />
                  {missing ? <Badge tone="warn">needs a choice</Badge> : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Drop the row on ${r.day}`}
                    onClick={() => {
                      setDrafts((d) => (d ?? []).filter((x) => x.key !== r.key));
                      setPicked((p) => { const n = new Set(p); n.delete(r.key); return n; });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>

          <p className="mt-3 border-t border-[var(--color-line)] pt-2.5 text-[11px] text-[var(--color-ink-3)]">
            Each row is saved under a key made from its own date, amount and wording, so pressing
            Import twice cannot double the batch — a repeat resolves to the row already there and
            is reported as such. Entries are timed at noon, which keeps them off the boundary
            between two statements. The server checks the date against its own clock, not this
            device&rsquo;s. Server time is {serverNow.slice(0, 16).replace('T', ' ')}.
          </p>
        </Panel>
      )}
    </>
  );
}
