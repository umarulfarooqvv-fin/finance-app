'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Camera, Check, Columns2, Copy, FileWarning, History, Sparkles, Trash2, X } from 'lucide-react';
import { parseImport, readyToImport, unsortedCount, type ImportRow } from '@/lib/import-parse';
import type { BankMethods } from '@/lib/bank-methods';
import { IMPORT_EXAMPLE, IMPORT_PROMPT } from '@/lib/import-prompt';
import { formatDayShort } from '@/lib/time';
import { Empty, Money, Panel, SectionTitle, cx } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/ui/toast';
import { importEntriesAction } from './actions';
import { retireCapturesAction } from '@/app/inbox/actions';
import { IMPORT_DRAFT_KEY, type HandedOver } from '@/lib/import-handoff';

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

type MatchLevel = 'exact' | 'likely' | 'new';

/** An entry the ledger already holds. */
type Ledger = {
  id: string; ts: string; amount: number; method: string; category: string; remarks: string;
};

type Existing = Ledger | null;

type Draft = ImportRow & {
  key: string;
  time: string;
  /** What the ledger says about this row. 'new' until the check has answered. */
  level: MatchLevel;
  existing: Existing;
  /** Ticked rows are the ones that will be saved. */
  include: boolean;
};

export function ImportClient({
  methods, categories, serverNow, entryCount, bankMethods, visionEnabled, visionLabel,
}: {
  methods: string[];
  categories: string[];
  serverNow: string;
  entryCount: number;
  /** Bank labels this ledger knows, so a pasted "Federal 2788" fills itself. */
  bankMethods: BankMethods;
  /** Whether IMPORT_AI is configured to read a photo directly. */
  visionEnabled: boolean;
  visionLabel: string;
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
  const [checking, setChecking] = useState(false);

  /* Photos read straight into paste-rows text, without a trip through an
     outside assistant. Chosen but not yet converted, so a person can add or
     drop one before spending the AI call on it. */
  const [photos, setPhotos] = useState<File[]>([]);
  const [converting, setConverting] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  /* Rows handed over from the Inbox: a photo read there arrives here the same
     way a paste would, so it goes through the identical read, duplicate check
     and confirmation rather than a shortcut of its own.

     The photo ids ride along, so that once these rows are actually saved the
     pictures they were read from can stop waiting in the inbox. */
  const [fromInbox, setFromInbox] = useState<string[]>([]);
  useEffect(() => {
    let raw = '';
    try { raw = sessionStorage.getItem(IMPORT_DRAFT_KEY) ?? ''; } catch { /* private browsing */ }
    if (!raw) return;
    try { sessionStorage.removeItem(IMPORT_DRAFT_KEY); } catch { /* private browsing */ }

    let handed: HandedOver;
    try {
      handed = JSON.parse(raw) as HandedOver;
    } catch {
      // An older hand-off was the bare text. Still perfectly importable.
      handed = { text: raw, captureIds: [] };
    }
    if (!handed.text?.trim()) return;

    setText((t) => (t.trim() ? `${t.trim()}\n${handed.text}` : handed.text));
    setFromInbox(handed.captureIds ?? []);
    notify('success', 'Rows read from your Inbox photos. Check them, then Import.');
  }, []);

  async function convertPhotos() {
    if (photos.length === 0) return;
    setConverting(true);
    try {
      const body = new FormData();
      for (const f of photos) body.append('file', f);
      const res = await fetch('/api/import/vision', { method: 'POST', body });
      const json = (await res.json()) as { ok: boolean; text?: string; error?: string };
      if (!json.ok || !json.text) {
        notify('error', json.error ?? 'Could not read those photos.');
        return;
      }
      setText((t) => (t.trim() ? `${t.trim()}\n${json.text}` : json.text!));
      setPhotos([]);
      if (photoInputRef.current) photoInputRef.current.value = '';
      notify('success', 'Photos converted — check the rows below before reading them.');
    } catch {
      notify('error', 'Could not reach the server. Check your connection.');
    } finally {
      setConverting(false);
    }
  }
  /* Everything the ledger already holds across the pasted window, and whether
     to show it. A badge saying "already recorded" asks to be trusted; the
     entries themselves can be read. */
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [compare, setCompare] = useState(false);

  function read() {
    const parsed = parseImport(text, { dateOrder, bankMethods });
    /* Noon, like every other date this app writes without a time: an entry at
       00:00 on a bill date sits exactly on the boundary between two
       statements, which is the one timestamp whose cycle depends on a rule. */
    const fresh: Draft[] = parsed.rows.map((r) => ({
      ...r, key: `r${r.line}`, time: '12:00:00',
      level: 'new', existing: null, include: true,
    }));
    setDrafts(fresh);
    setSkipped(parsed.skipped);
    setPicked(new Set());
    setLedger([]);
    void checkAgainstLedger(fresh);
  }

  /* Ask the ledger which of these it already has. The idempotency key stops a
     paste doubling ITSELF; it cannot know about a row typed by hand in August,
     which has a different id and would sail straight through.

     An EXACT match is unticked by default — same day, amount, method, filing
     and wording is the same expense. A LIKELY one stays ticked: the app cannot
     tell a duplicate from a second ₹250 on a busy Tuesday, and quietly
     dropping a real expense is the worse mistake. */
  async function checkAgainstLedger(rows: Draft[]) {
    if (rows.length === 0) return;
    setChecking(true);
    try {
      const res = await fetch('/api/import/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rows: rows.map((r) => ({
            line: r.line, day: r.day, amount: r.amount,
            method: r.method, category: r.category, remarks: r.remarks,
          })),
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        existing?: Ledger[];
        matches?: { line: number; level: MatchLevel; existing: Existing }[];
      };
      if (!json.ok || !json.matches) return;

      setLedger(json.existing ?? []);

      const byLine = new Map(json.matches.map((m) => [m.line, m]));
      setDrafts((d) => (d ?? []).map((r) => {
        const m = byLine.get(r.line);
        if (!m) return r;
        return { ...r, level: m.level, existing: m.existing, include: m.level !== 'exact' };
      }));
    } catch {
      // The check is a safeguard, not a gate. Losing it must not stop an
      // import — it only means the duplicate badges do not appear.
      notify('error', 'Could not check for entries you already have. Import still works.');
    } finally {
      setChecking(false);
    }
  }

  const rows = drafts ?? [];
  /* Only the ticked rows are saved, so everything below counts those. An
     untick is how a row already in the ledger is left out without deleting it
     from the table, where it still explains itself. */
  const chosen = rows.filter((r) => r.include);
  const ready = readyToImport(chosen);
  const total = chosen.reduce((a, r) => a + r.amount, 0);
  const noMethod = chosen.filter((r) => !r.method).length;
  const unsorted = unsortedCount(chosen);
  const already = rows.filter((r) => r.level === 'exact').length;
  const maybe = rows.filter((r) => r.level === 'likely').length;

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

  /* Grouped by day, because every transaction list in this app is. A flat run
     of seventy rows gives no sense of WHEN, which is the thing being checked
     against the ledger. */
  /* Which recorded entries the matcher has already spoken for. The rest are
     the interesting ones: money that IS in the ledger for these days and is
     nowhere in the paste — usually cash, or a transfer the bank statement
     never saw. */
  const claimed = new Set(rows.map((r) => r.existing?.id).filter(Boolean) as string[]);

  const groups = (() => {
    const byRow = new Map<string, Draft[]>();
    for (const r of rows) byRow.set(r.day, [...(byRow.get(r.day) ?? []), r]);

    const byLedger = new Map<string, Ledger[]>();
    if (compare) {
      for (const t of ledger) {
        const d = t.ts.slice(0, 10);
        byLedger.set(d, [...(byLedger.get(d) ?? []), t]);
      }
    }

    const days = [...new Set([...byRow.keys(), ...byLedger.keys()])].sort();
    return days.map((day) => {
      const items = byRow.get(day) ?? [];
      const mine = byLedger.get(day) ?? [];
      return {
        day,
        items,
        mine,
        total: items.reduce((a, r) => a + (r.include ? r.amount : 0), 0),
        recorded: mine.reduce((a, t) => a + t.amount, 0),
        chosen: items.filter((r) => r.include).length,
      };
    });
  })();

  /* A key derived from the row's own content, so pressing Import twice — or
     once on a flaky connection — resolves to the same row rather than doubling
     the batch. */
  const keyFor = (r: Draft) =>
    `import:${r.day}:${r.time}:${r.amount}:${r.method}:${r.category}:${r.remarks}`;

  function save() {
    startTransition(async () => {
      const result = await importEntriesAction({
        rows: chosen.map((r) => ({
          clientKey: keyFor(r),
          ts: `${r.day}T${r.time}`,
          amount: String(r.amount),
          method: r.method,
          category: r.category,
          remarks: r.remarks,
        })),
      });

      if (!result.ok) { notify('error', result.error); return; }

      const { saved, duplicates, unsorted: unfiled, failed } = result.data;
      const parts = [`${saved} saved`];
      if (unfiled > 0) parts.push(`${unfiled} unfiled`);
      if (duplicates > 0) parts.push(`${duplicates} already there`);
      if (failed.length > 0) parts.push(`${failed.length} refused`);
      notify(failed.length > 0 ? 'error' : 'success', parts.join(' · '));

      if (failed.length === 0) {
        /* Everything landed, so the photos these rows were read from have
           done their job and can leave the inbox. Only on a clean import: a
           photo whose row was refused is still the only record of it. */
        if (fromInbox.length > 0 && result.data.ids.length > 0) {
          const retired = await retireCapturesAction({
            ids: fromInbox,
            transactionId: result.data.ids[0]!,
          });
          if (retired.ok) setFromInbox([]);
        }
        setText('');
        setDrafts(null);
        setSkipped([]);
        setLedger([]);
        setCompare(false);
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

        {/* ---- Read photos directly, no outside assistant needed ------- */}
        <div className="mb-3 rounded-[var(--radius-field)] border border-dashed border-[var(--color-line)] bg-[var(--color-canvas)] p-3">
          {visionEnabled ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={photoInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  className="hidden"
                  onChange={(e) => setPhotos([...(e.target.files ?? [])])}
                />
                <Button
                  type="button" variant="secondary" size="sm" disabled={converting}
                  onClick={() => photoInputRef.current?.click()}
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  {photos.length > 0 ? `${photos.length} chosen` : 'Choose photos'}
                </Button>
                <Button
                  type="button" size="sm" pending={converting}
                  disabled={photos.length === 0}
                  onClick={convertPhotos}
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  {converting ? 'Reading…' : 'Convert to rows'}
                </Button>
                {photos.length > 0 && !converting ? (
                  <Button
                    type="button" variant="ghost" size="icon"
                    onClick={() => { setPhotos([]); if (photoInputRef.current) photoInputRef.current.value = ''; }}
                    aria-label="Clear chosen photos"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : null}
                <span className="text-[11px] text-[var(--color-ink-3)]">
                  Read by {visionLabel} — added below as rows, same as a paste
                </span>
              </div>
              {photos.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {photos.map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="max-w-[10rem] truncate rounded-full bg-[var(--color-raised)] px-2 py-0.5 text-[10px] text-[var(--color-ink-3)]"
                    >
                      {f.name}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-[11px] text-[var(--color-ink-3)]">
              <Camera className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" />
              Photos can be read straight into rows here — set <code>IMPORT_AI</code> in
              <code> .env.example</code> to a free vision model (Groq, OpenRouter or a local
              Ollama) to turn this on. Until then, use &ldquo;Copy the prompt&rdquo; above with
              any assistant instead.
            </p>
          )}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          spellCheck={false}
          aria-label="Rows to import"
          placeholder={IMPORT_EXAMPLE}
          className={cn(inputClass(), 'min-h-[8rem] resize-y font-mono text-[11px] leading-relaxed')}
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
              onClick={() => {
                setText(''); setDrafts(null); setSkipped([]);
                setPicked(new Set()); setLedger([]); setCompare(false);
              }}
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
                Import {chosen.length} {chosen.length === 1 ? 'entry' : 'entries'}
              </Button>
            }
          >
            Ready to import &middot; {rows.length}
          </SectionTitle>

          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-[var(--color-ink-2)]">
              Totalling <Money value={total} size="sm" tone="debt" className="font-semibold" />
            </span>
            {noMethod > 0 ? (
              <span className="flex items-center gap-1.5 text-[var(--color-warn)]">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                {noMethod} still {noMethod === 1 ? 'needs' : 'need'} a method &mdash; without one the
                money lands on no card
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[var(--color-pos)]">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Ready to import
              </span>
            )}
            {unsorted > 0 ? (
              <span className="text-[var(--color-ink-3)]">
                {unsorted} will go in <strong className="text-[var(--color-ink-2)]">unfiled</strong>
                {' '}and show on Settings until sorted
              </span>
            ) : null}
            {checking ? (
              <span className="text-[var(--color-ink-3)]">checking what you already have&hellip;</span>
            ) : already + maybe > 0 ? (
              <span className="flex flex-wrap items-center gap-1.5 text-[var(--color-ink-3)]">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                {already > 0 ? `${already} already recorded, unticked` : null}
                {already > 0 && maybe > 0 ? ' · ' : null}
                {maybe > 0 ? `${maybe} possibly already there` : null}
                {/* The maybes are left ticked on purpose, but judging them one
                    at a time across forty rows is its own reason to give up. */}
                {maybe > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDrafts((d) => (d ?? []).map((r) =>
                        r.level === 'likely' ? { ...r, include: false } : r))
                    }
                  >
                    Untick those {maybe} too
                  </Button>
                ) : null}
              </span>
            ) : null}
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
                  className={cn(inputClass(), 'min-w-0 flex-1 text-xs')}
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
                  className={cn(inputClass(), 'w-32 shrink-0 text-xs')}
                >
                  <option value="">Set method…</option>
                  {methods.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select
                  value=""
                  aria-label="Set the category for all selected rows"
                  onChange={(e) => e.target.value && applyToPicked({ category: e.target.value })}
                  className={cn(inputClass(), 'w-36 shrink-0 text-xs')}
                >
                  <option value="">Set category…</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          ) : null}

          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--color-line)] pt-2.5 text-[11px] text-[var(--color-ink-3)]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.key)))}
                aria-label="Select every row"
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              Select all, to set them together
            </label>
            {ledger.length > 0 ? (
              <>
                <span aria-hidden="true">&middot;</span>
                <Button size="sm" variant="ghost" onClick={() => setCompare((c) => !c)}>
                  <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {compare
                    ? 'Hide what is already recorded'
                    : `Show the ${ledger.length} entries already in these days`}
                </Button>
              </>
            ) : null}
          </div>

          {/* One line per entry, grouped by day. Two selects and a description
              on one row need the width, so the grid collapses to two lines on
              a narrow screen rather than the five it used to take. */}
          {groups.map((g) => (
            <section key={g.day}>
              <h3 className="-mx-4 flex items-baseline justify-between gap-3 border-y border-[var(--color-line)] bg-[var(--color-raised)] px-4 py-1.5 sm:-mx-5 sm:px-5">
                <span className="text-xs font-semibold">
                  {formatDayShort(g.day)}
                  <span className="ml-2 font-normal text-[var(--color-ink-3)]">
                    {g.chosen} of {g.items.length}
                  </span>
                </span>
                {g.total > 0 ? (
                  <Money value={g.total} size="sm" tone="debt" className="font-semibold" />
                ) : (
                  <span className="text-xs text-[var(--color-ink-3)]">nothing to add</span>
                )}
              </h3>

              <div className={cx(compare && 'gap-x-5 sm:grid sm:grid-cols-2')}>
              <ul className="flex min-w-0 flex-col">
                {g.items.map((r) => (
                  <li
                    key={r.key}
                    className={cx(
                      'border-b border-[var(--color-line)] py-1.5 last:border-b-0',
                      picked.has(r.key) && 'bg-[var(--color-accent-soft)]',
                      !r.include && 'opacity-50',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      <input
                        type="checkbox"
                        checked={picked.has(r.key)}
                        onChange={() => toggle(r.key)}
                        aria-label={`Select ${r.remarks || 'row'} on ${r.day}`}
                        className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                      />
                      <input
                        value={r.remarks}
                        onChange={(e) => set(r.key, { remarks: e.target.value })}
                        placeholder="What was it for?"
                        aria-label={`Description for the row on ${r.day}`}
                        className={cn(inputClass(), 'min-w-0 flex-1 basis-40 border-0 bg-transparent px-1 py-1 text-xs')}
                      />
                      {/* One group, so the controls wrap TOGETHER onto a second
                          line when the column is halved for the comparison —
                          two tidy lines rather than five stacked ones. */}
                      <span className="flex shrink-0 items-center gap-1">
                      <select
                        value={r.method}
                        onChange={(e) => set(r.key, { method: e.target.value })}
                        aria-label={`Method for the row on ${r.day}`}
                        className={cn(
                          inputClass(), 'w-[6.5rem] shrink-0 px-1.5 py-1 text-[11px]',
                          !r.method && 'border-[var(--color-warn)]',
                        )}
                      >
                        <option value="">Method…</option>
                        {methods.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <select
                        value={r.category}
                        onChange={(e) => set(r.key, { category: e.target.value })}
                        aria-label={`Category for the row on ${r.day}`}
                        className={cn(inputClass(), 'w-[7.5rem] shrink-0 px-1.5 py-1 text-[11px]')}
                      >
                        <option value="">Unfiled</option>
                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <span className="w-[4.5rem] shrink-0 text-right">
                        <Money value={r.amount} size="sm" tone="debt" />
                      </span>
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
                      </span>
                    </div>

                    {/* What it matched, said out loud rather than hidden in a
                        tooltip — the whole decision rests on this line. */}
                    {r.existing ? (
                      <label className="mt-0.5 flex flex-wrap items-center gap-1.5 pl-6 text-[11px]">
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={() => set(r.key, { include: !r.include })}
                          aria-label={`Import the row on ${r.day} anyway`}
                          className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                        />
                        <span className={r.level === 'exact' ? 'text-[var(--color-pos)]' : 'text-[var(--color-warn)]'}>
                          {r.level === 'exact' ? 'Already recorded' : 'Possibly already there'}
                        </span>
                        <span className="text-[var(--color-ink-3)]">
                          as &ldquo;{r.existing.remarks || r.existing.category}&rdquo; on{' '}
                          {r.existing.method}
                          {r.level === 'likely' && r.method && r.existing.method !== r.method
                            ? ` — you pasted ${r.method}`
                            : null}
                        </span>
                      </label>
                    ) : null}
                  </li>
                ))}
                {compare && g.items.length === 0 ? (
                  <li className="py-2 text-[11px] text-[var(--color-ink-3)]">
                    Nothing pasted for this day.
                  </li>
                ) : null}
              </ul>

              {/* ---- The same day, as the ledger already has it ---------- */}
              {compare ? (
                <div className="mt-1 min-w-0 border-t border-dashed border-[var(--color-line)] pt-1 sm:mt-0 sm:border-t-0 sm:border-l sm:border-solid sm:pl-5 sm:pt-0">
                  <span className="flex items-baseline justify-between gap-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
                    Already recorded
                    {g.recorded > 0 ? <Money value={g.recorded} size="sm" tone="muted" /> : null}
                  </span>
                  {g.mine.length === 0 ? (
                    <p className="py-1 text-[11px] text-[var(--color-ink-3)]">
                      Nothing on this day yet.
                    </p>
                  ) : (
                    <ul className="flex flex-col">
                      {g.mine.map((t) => (
                        <li
                          key={t.id}
                          className="flex items-center gap-2 border-b border-[var(--color-line)] py-1.5 text-[11px] last:border-b-0"
                        >
                          {/* A tick means a pasted row claimed this one, so the
                              two lists line up and nothing is being counted
                              twice. No tick means the ledger has an expense the
                              paste never mentioned — cash, usually. */}
                          {claimed.has(t.id) ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-pos)]" aria-label="matched by a pasted row" />
                          ) : (
                            <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {t.remarks || <span className="text-[var(--color-ink-3)]">no description</span>}
                          </span>
                          <span className="shrink-0 text-[var(--color-ink-3)]">
                            {t.method}{t.category ? ` · ${t.category}` : ''}
                          </span>
                          <span className="w-20 shrink-0 text-right">
                            <Money value={t.amount} size="sm" tone="muted" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
              </div>
            </section>
          ))}

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
