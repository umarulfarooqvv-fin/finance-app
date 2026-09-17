'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, CreditCard, FileWarning, Link2,
  Undo2, Wand2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { parseStatement, type StatementLine } from '@/lib/statement-parse';
import {
  chargeFlag, isBankCharge, reconcileStatement, suggestFor,
  type AppEntry, type Match,
} from '@/lib/statement-match';
import { formatDayShort } from '@/lib/time';
import { round2 } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/field';
import { Badge, Empty, Money, Panel, SectionTitle, cx } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { reassignMethodAction } from './actions';

/* ===========================================================================
   Reconciling a pasted statement, line by line.

   Everything runs in the browser. The statement text is never sent anywhere:
   a document listing every card transaction of the month stays on the device
   it was pasted into.

   The page is built around ONE NUMBER — what is still unexplained — and that
   number falls as rows get paired off. Automatic matching resolves the
   obvious ones; the rest are paired by hand, with suggestions, until the
   figure reaches zero or the remainder is something worth asking the bank
   about. A reconciliation that only ever showed a static verdict left the
   hard part exactly where it started.
   =========================================================================== */

const PLACEHOLDER = `Paste the statement rows. Anything works — copy straight out of a spreadsheet:

25/08/2026	SWIGGY BANGALORE	450.00
25/08/2026	ANNUAL MEMBERSHIP FEE	590.00
26/08/2026	IGST @18%	106.20`;

/** A pairing made by hand. Statement lines and entries are held by identity. */
type ManualLink = { id: string; statement: StatementLine[]; app: AppEntry[] };

/** An entry in this window that is filed against some OTHER payment method. */
export type MisfiledCandidate = AppEntry & { method: string };

export function ReconcileClient({
  entries, elsewhere, methods, card, periodYear,
}: {
  entries: AppEntry[];
  /** Entries in the same window filed against a different method. */
  elsewhere: MisfiledCandidate[];
  methods: string[];
  card: string;
  periodYear: number;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [moving, setMoving] = useState<string | null>(null);

  /* Move an entry onto (or off) this card. The page then re-reads, so a row
     that was misfiled simply matches on the next render rather than needing
     to be paired by hand. */
  function move(id: string, method: string, label: string) {
    setMoving(id);
    void reassignMethodAction({ id, method }).then((result) => {
      setMoving(null);
      if (!result.ok) { notify('error', result.error); return; }
      notify('success', `${label} moved to ${method}.`);
      router.refresh();
    });
  }
  const [text, setText] = useState('');
  const [dateOrder, setDateOrder] = useState<'dmy' | 'mdy'>('dmy');
  const [tolerance, setTolerance] = useState(4);
  const [submitted, setSubmitted] = useState('');

  const [links, setLinks] = useState<ManualLink[]>([]);
  const [pickedLines, setPickedLines] = useState<Set<number>>(new Set());
  const [pickedApp, setPickedApp] = useState<Set<string>>(new Set());
  const [suggestFor_, setSuggestFor] = useState<number | null>(null);

  const parsed = useMemo(
    () => parseStatement(submitted, { dateOrder, assumeYear: periodYear }),
    [submitted, dateOrder, periodYear],
  );

  const auto = useMemo(
    () => reconcileStatement(parsed.lines, entries, { tolerance }),
    [parsed.lines, entries, tolerance],
  );

  /* What is left after BOTH automatic matching and everything paired by hand.
     Derived, never stored: a remainder held in state drifts out of step with
     the links that produced it the first time anything is undone. */
  const linkedLines = useMemo(
    () => new Set(links.flatMap((l) => l.statement.map((s) => s.line))),
    [links],
  );
  const linkedApp = useMemo(
    () => new Set(links.flatMap((l) => l.app.map((a) => a.id))),
    [links],
  );

  const openLines = auto.statementOnly.filter((l) => !linkedLines.has(l.line));
  const openApp = auto.appOnly.filter((e) => !linkedApp.has(e.id));

  const sum = (xs: { amount: number }[]) => round2(xs.reduce((a, x) => a + x.amount, 0));
  const signed = (xs: { amount: number; direction: string }[]) =>
    round2(xs.reduce((a, x) => a + (x.direction === 'credit' ? -x.amount : x.amount), 0));

  const remaining = round2(signed(openLines) - signed(openApp));
  const started = round2(signed(auto.statementOnly) - signed(auto.appOnly));

  const selectedLines = openLines.filter((l) => pickedLines.has(l.line));
  const selectedApp = openApp.filter((e) => pickedApp.has(e.id));
  const selectionGap = round2(sum(selectedLines) - sum(selectedApp));
  const canLink = selectedLines.length > 0 && selectedApp.length > 0;

  function link() {
    if (!canLink) return;
    setLinks((prev) => [
      ...prev,
      { id: `m-${Date.now()}`, statement: selectedLines, app: selectedApp },
    ]);
    setPickedLines(new Set());
    setPickedApp(new Set());
    setSuggestFor(null);
  }

  function unlink(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }

  function applySuggestion(line: StatementLine, app: AppEntry[]) {
    setLinks((prev) => [...prev, { id: `m-${Date.now()}`, statement: [line], app }]);
    setSuggestFor(null);
    setPickedLines(new Set());
    setPickedApp(new Set());
  }

  const toggle = <T,>(set: Set<T>, value: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  const hasRun = submitted.trim().length > 0;

  // The findings: unmatched lines the description marks as a bank charge.
  const charges = openLines.filter((l) => isBankCharge(l.description));
  const unlogged = openLines.filter((l) => !isBankCharge(l.description));

  return (
    <>
      <Panel className="mb-4">
        <SectionTitle>Paste the statement</SectionTitle>
        <p className="mb-2 text-xs text-[var(--color-ink-2)]">
          Copy the rows out of a spreadsheet, a PDF, or whatever an assistant gives you. Columns are
          read properly, so a running-balance column or a reference number is not mistaken for the
          amount. The text stays in your browser.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          aria-label="Statement rows"
          className={cx(inputClass(), 'min-h-[9rem] resize-y font-mono text-[11px] leading-relaxed')}
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

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--color-ink-3)]">Posting delay</span>
            <select
              value={String(tolerance)}
              onChange={(e) => setTolerance(Number(e.target.value))}
              className={inputClass()}
            >
              {[0, 2, 4, 7, 10].map((n) => (
                <option key={n} value={n}>{n === 0 ? 'Same day only' : `${n} days`}</option>
              ))}
            </select>
          </label>

          <Button
            type="button"
            onClick={() => { setSubmitted(text); setLinks([]); setPickedLines(new Set()); setPickedApp(new Set()); }}
            disabled={!text.trim()}
          >
            Match against {card}
          </Button>
          {hasRun ? (
            <Button
              type="button" variant="ghost"
              onClick={() => { setText(''); setSubmitted(''); setLinks([]); }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </Panel>

      {!hasRun ? null : (
        <>
          {/* ---- The one number ------------------------------------------ */}
          <Panel className="mb-4">
            <SectionTitle>Still unexplained</SectionTitle>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <Money
                value={Math.abs(remaining)}
                size="display"
                tone={Math.abs(remaining) < 0.005 ? 'credit' : 'debt'}
              />
              {Math.abs(started) > 0.005 ? (
                <span className="text-xs text-[var(--color-ink-3)]">
                  started at <span className="sensitive num">{Math.abs(started).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  {links.length > 0 ? ` · ${links.length} paired by hand` : ''}
                </span>
              ) : null}
            </div>

            <p className="mt-3 flex items-start gap-2 border-t border-[var(--color-line)] pt-3 text-xs">
              {Math.abs(remaining) < 0.005 ? (
                <>
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-pos)]" aria-hidden="true" />
                  <span className="text-[var(--color-pos)]">
                    Every line on the statement is accounted for. This cycle reconciles.
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
                  <span className="text-[var(--color-ink-2)]">
                    {openLines.length} statement {openLines.length === 1 ? 'line' : 'lines'} and{' '}
                    {openApp.length} {openApp.length === 1 ? 'entry' : 'entries'} still to pair.
                    {charges.length > 0
                      ? ' Some look like charges the bank added — see below.'
                      : ''}
                  </span>
                </>
              )}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--color-line)] pt-3 sm:grid-cols-4">
              <Figure label="Statement charges" value={auto.totals.statementDebit} />
              <Figure label="Recorded here" value={auto.totals.appDebit} />
              <Figure label="Matched automatically" value={String(auto.matches.length)} plain />
              <Figure label="Payments &amp; refunds" value={auto.totals.statementCredit} tone="credit" />
            </div>

            {parsed.ambiguousDates > 0 ? (
              <p className="mt-2 flex items-start gap-2 text-[11px] text-[var(--color-warn)]">
                <CircleHelp className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>
                  {parsed.ambiguousDates} {parsed.ambiguousDates === 1 ? 'date' : 'dates'} could be
                  read either way round — check the date order if matches look wrong.
                </span>
              </p>
            ) : null}
          </Panel>

          {/* ---- The findings -------------------------------------------- */}
          {charges.length > 0 ? (
            <Panel className="mb-4">
              <SectionTitle>Charges the bank added &middot; {charges.length}</SectionTitle>
              <p className="mb-2 text-xs text-[var(--color-ink-2)]">
                Unmatched lines whose description says they are a fee, a tax or interest rather than
                something bought. This is the list worth reading.
              </p>
              <ul className="flex flex-col">
                {charges.map((l) => (
                  <li key={l.line} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0">
                    <span className="num w-24 shrink-0 text-xs text-[var(--color-ink-3)]">
                      {formatDayShort(l.day)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{l.description}</span>
                    <Badge tone="warn">{chargeFlag(l.description)?.label}</Badge>
                    <Money value={l.amount} size="sm" tone="debt" />
                  </li>
                ))}
                <li className="flex items-center justify-between gap-2 pt-2 text-xs">
                  <span className="text-[var(--color-ink-3)]">Total added by the bank</span>
                  <Money value={sum(charges)} size="sm" tone="debt" className="font-semibold" />
                </li>
              </ul>
            </Panel>
          ) : null}

          {/* ---- The mapping table --------------------------------------- */}
          <Panel className="mb-4">
            <SectionTitle>
              Pair what is left
              {canLink ? (
                <span className="ml-2 text-xs font-normal text-[var(--color-ink-3)]">
                  {selectedLines.length} statement &middot; {selectedApp.length} here &middot;{' '}
                  {Math.abs(selectionGap) < 0.005
                    ? 'they balance'
                    : `${selectionGap > 0 ? 'short' : 'over'} by ${Math.abs(selectionGap).toFixed(2)}`}
                </span>
              ) : null}
            </SectionTitle>

            {openLines.length === 0 && openApp.length === 0 ? (
              <Empty title="Nothing left to pair" hint="Every row has been accounted for." />
            ) : (
              <>
                <p className="mb-3 text-xs text-[var(--color-ink-2)]">
                  Tick rows on both sides and link them. Several on one side may pair with one on the
                  other — that is the split case, and the running total above falls by whatever you
                  pair off.
                </p>

                {canLink ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-field)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-2">
                    <Link2 className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
                    <span className="min-w-0 flex-1 text-xs text-[var(--color-ink-2)]">
                      <span className="sensitive num font-semibold">{sum(selectedLines).toFixed(2)}</span>{' '}
                      on the statement against{' '}
                      <span className="sensitive num font-semibold">{sum(selectedApp).toFixed(2)}</span>{' '}
                      here
                      {Math.abs(selectionGap) >= 0.005 ? (
                        <span className="text-[var(--color-warn)]">
                          {' '}— a difference of {Math.abs(selectionGap).toFixed(2)} will stay unexplained
                        </span>
                      ) : null}
                    </span>
                    <Button size="sm" onClick={link}>Link these</Button>
                  </div>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-2">
                  <Side
                    title={`On the statement · ${openLines.length}`}
                    empty="Every statement line is accounted for."
                  >
                    {openLines.map((l) => {
                      const flag = chargeFlag(l.description);
                      const open = suggestFor_ === l.line;
                      const ideas = open ? suggestFor(l, openApp, { tolerance: Math.max(tolerance, 7) }) : [];
                      /* Exact-amount, same-direction, nearby — a strong signal the
                         entry exists but went onto the wrong card. Deliberately
                         stricter than the general suggestions: moving money between
                         cards on a loose guess is worse than not offering it. */
                      const misfiled = open
                        ? elsewhere.filter(
                            (m) =>
                              m.direction === l.direction &&
                              Math.round(m.amount * 100) === Math.round(l.amount * 100) &&
                              Math.abs(
                                (new Date(`${m.day}T00:00:00Z`).getTime() -
                                  new Date(`${l.day}T00:00:00Z`).getTime()) / 86400000,
                              ) <= Math.max(tolerance, 7),
                          )
                        : [];
                      return (
                        <li key={l.line} className="border-b border-[var(--color-line)] last:border-b-0">
                          <div className="flex flex-wrap items-center gap-2 py-2">
                            <input
                              type="checkbox"
                              checked={pickedLines.has(l.line)}
                              onChange={() => toggle(pickedLines, l.line, setPickedLines)}
                              aria-label={`Select ${l.description}`}
                              className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                            />
                            <span className="num w-20 shrink-0 text-xs text-[var(--color-ink-3)]">
                              {formatDayShort(l.day)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">{l.description}</span>
                            {flag ? <Badge tone="warn">{flag.label}</Badge> : null}
                            <Money value={l.amount} size="sm" tone={l.direction === 'credit' ? 'credit' : 'debt'} />
                            <Button
                              variant="ghost" size="icon"
                              aria-label={`Suggest a match for ${l.description}`}
                              onClick={() => setSuggestFor(open ? null : l.line)}
                            >
                              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>

                          {open ? (
                            <div className="flex flex-col gap-2 pb-2 pl-6">
                              {/* Filed against a different card. This is the case where
                                  the entry exists but was put on the wrong method, so it
                                  never appears on the statement being checked. */}
                              {misfiled.length > 0 ? (
                                <div className="rounded-[var(--radius-field)] border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-2.5 py-2">
                                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-warn)]">
                                    <CreditCard className="h-3 w-3" aria-hidden="true" />
                                    Same amount, filed on another card
                                  </div>
                                  <ul className="flex flex-col gap-1">
                                    {misfiled.map((m) => (
                                      <li key={m.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                                        <span className="min-w-0 flex-1 truncate">{m.description}</span>
                                        <Badge tone="neutral">on {m.method}</Badge>
                                        <Money value={m.amount} size="sm" />
                                        <Button
                                          size="sm" variant="secondary" disabled={moving === m.id}
                                          onClick={() => move(m.id, card, m.description)}
                                        >
                                          Move to {card}
                                        </Button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}

                              {ideas.length === 0 && misfiled.length === 0 ? (
                                <p className="text-[11px] text-[var(--color-ink-3)]">
                                  Nothing here comes close. It is probably a charge the bank added.
                                </p>
                              ) : ideas.length === 0 ? null : (
                                <ul className="flex flex-col gap-1">
                                  {ideas.map((s, i) => (
                                    <li key={i} className="flex flex-wrap items-center gap-2 text-[11px]">
                                      <span className="min-w-0 flex-1 truncate">
                                        {s.app.map((a) => a.description).join(' + ')}
                                      </span>
                                      <span className="text-[var(--color-ink-3)]">{s.reason}</span>
                                      <Money value={s.total} size="sm" />
                                      <Button size="sm" variant="secondary" onClick={() => applySuggestion(l, s.app)}>
                                        Use
                                      </Button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </Side>

                  <Side
                    title={`Recorded here · ${openApp.length}`}
                    empty="Every entry is accounted for."
                  >
                    {openApp.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 last:border-b-0">
                        <input
                          type="checkbox"
                          checked={pickedApp.has(e.id)}
                          onChange={() => toggle(pickedApp, e.id, setPickedApp)}
                          aria-label={`Select ${e.description}`}
                          className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                        />
                        <span className="num w-20 shrink-0 text-xs text-[var(--color-ink-3)]">
                          {formatDayShort(e.day)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{e.description}</span>
                        <Money value={e.amount} size="sm" tone={e.direction === 'credit' ? 'credit' : 'debt'} />
                        {/* Not on this statement? It may be on the wrong card.
                            Changing the method here re-files it, and it drops out
                            of this reconciliation on the next render. */}
                        <select
                          value=""
                          disabled={moving === e.id}
                          aria-label={`Move ${e.description} to another payment method`}
                          onChange={(ev) => ev.target.value && move(e.id, ev.target.value, e.description)}
                          className={cx(inputClass(), 'w-[6.5rem] shrink-0 text-[11px]')}
                        >
                          <option value="">Move to…</option>
                          {methods.filter((m) => m !== card).map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </Side>
                </div>
              </>
            )}
          </Panel>

          {/* ---- What has been paired ------------------------------------ */}
          {links.length > 0 ? (
            <Panel className="mb-4">
              <SectionTitle>Paired by hand &middot; {links.length}</SectionTitle>
              <ul className="flex flex-col">
                {links.map((l) => {
                  const gap = round2(sum(l.statement) - sum(l.app));
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] py-2 text-xs last:border-b-0">
                      <span className="min-w-0 flex-1 truncate">
                        {l.statement.map((s) => s.description).join(' + ')}
                      </span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[var(--color-ink-2)]">
                        {l.app.map((a) => a.description).join(' + ')}
                      </span>
                      {l.statement.length > 1 || l.app.length > 1 ? (
                        <Badge tone="accent">{l.statement.length}&rarr;{l.app.length}</Badge>
                      ) : null}
                      {Math.abs(gap) >= 0.005 ? <Badge tone="warn">{gap.toFixed(2)} off</Badge> : null}
                      <Money value={sum(l.statement)} size="sm" />
                      <Button variant="ghost" size="icon" aria-label="Undo this pairing" onClick={() => unlink(l.id)}>
                        <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}

          {unlogged.length > 0 ? (
            <Panel className="mb-4">
              <SectionTitle>Not recorded here &middot; {unlogged.length}</SectionTitle>
              <p className="text-xs text-[var(--color-ink-2)]">
                Purchases on the statement with nothing behind them. Either they were never logged,
                or they went on a different card.
              </p>
            </Panel>
          ) : null}

          {parsed.skipped.length > 0 ? (
            <Panel className="mb-4">
              <SectionTitle>
                {parsed.skipped.length} {parsed.skipped.length === 1 ? 'line' : 'lines'} could not be read
              </SectionTitle>
              <p className="mb-2 text-xs text-[var(--color-ink-2)]">
                Not counted in anything above. Shown so they can be fixed in the paste rather than
                quietly missing from the comparison.
              </p>
              <ul className="flex flex-col gap-1">
                {parsed.skipped.map((s) => (
                  <li key={s.line} className="flex items-start gap-2 text-[11px]">
                    <FileWarning className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
                    <span className="num shrink-0 text-[var(--color-ink-3)]">line {s.line}</span>
                    <code className="min-w-0 flex-1 truncate">{s.raw}</code>
                    <span className="shrink-0 text-[var(--color-ink-3)]">{s.why}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel>
            <SectionTitle>Matched automatically &middot; {auto.matches.length}</SectionTitle>
            {auto.matches.length === 0 ? (
              <p className="text-xs text-[var(--color-ink-3)]">Nothing matched on its own.</p>
            ) : (
              <ul className="flex flex-col">
                {auto.matches.map((m, i) => <MatchRow key={i} match={m} />)}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

function Side({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const list = Array.isArray(children) ? children : [children];
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        {title}
      </div>
      {list.length === 0 ? (
        <p className="py-3 text-[11px] text-[var(--color-ink-3)]">{empty}</p>
      ) : (
        <ul className="flex flex-col">{children}</ul>
      )}
    </div>
  );
}

function Figure({
  label, value, tone = 'neutral', plain = false,
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'debt' | 'credit' | 'muted';
  plain?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">{label}</div>
      <div className="mt-1">
        {plain
          ? <span className="num text-lg font-semibold tracking-tight">{value}</span>
          : <Money value={value as number} tone={tone} size="lg" />}
      </div>
    </div>
  );
}

function MatchRow({ match }: { match: Match }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] py-2 text-sm last:border-b-0">
      <span className="num w-20 shrink-0 text-xs text-[var(--color-ink-3)]">
        {formatDayShort(match.statement[0]!.day)}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {match.statement.map((l) => l.description).join(' + ')}
      </span>
      <ArrowRight className="h-3 w-3 shrink-0 text-[var(--color-ink-3)]" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-ink-2)]">
        {match.app.map((e) => e.description).join(' + ')}
      </span>
      {match.kind === 'grouped' ? (
        <Badge tone="accent">{match.statement.length}&rarr;{match.app.length}</Badge>
      ) : null}
      {match.kind === 'near' ? <Badge tone="neutral">{match.dayGap}d later</Badge> : null}
      <Money value={match.total} size="sm" />
    </li>
  );
}
